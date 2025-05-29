// src/server.js

import express from "express";
import twilio from "twilio";
import axios from "axios";
import FormData from "form-data";

const { VoiceResponse } = twilio.twiml;
const app = express();
app.use(express.urlencoded({ extended: false }));

// 1) Entry point: greet & record
app.post("/voice-webhook", (req, res) => {
  const response = new VoiceResponse();

  response.say(
    { voice: "Polly.Joanna", language: "en-US" },
    "Thanks for calling ServiceSwarm HVAC repair. Please tell us briefly what you need after the tone."
  );
  response.record({
    action: "/recording-handler",
    method: "POST",
    maxLength: 15,
    playBeep: true
  });
  response.hangup();

  res.type("text/xml");
  res.send(response.toString());
});

// 2) Handle the recording callback, transcription & intent parsing
app.post("/recording-handler", async (req, res) => {
  try {
    const recordingUrl = req.body.RecordingUrl + ".wav";
    console.log("Recording URL:", recordingUrl);

    // Transcribe with Whisper
    const audioRes = await axios.get(recordingUrl, { responseType: "stream" });
    const form = new FormData();
    form.append("file", audioRes.data, "recording.wav");
    form.append("model", "whisper-1");
    const whisperRes = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        }
      }
    );
    const transcript = whisperRes.data.text;
    console.log("Transcript:", transcript);

    // Parse intent & slots with GPT-4o
    const chatRes = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "You are a scheduling assistant for HVAC repair. " +
              "Given a caller’s transcript, output ONLY a JSON object " +
              "with fields: intent ('booking' or 'other'), date (YYYY-MM-DD or empty), " +
              "time (HH:MM AM/PM or empty), and raw_transcript."
          },
          { role: "user", content: transcript }
        ],
        temperature: 0
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const nlu = JSON.parse(chatRes.data.choices[0].message.content);
    console.log("NLU result:", nlu);

    // Build TwiML response
    const twimlResp = new VoiceResponse();
    if (nlu.intent === "booking" && nlu.date && nlu.time) {
      // Stub scheduler call here
      twimlResp.say(
        `Great! Your service is booked for ${nlu.date} at ${nlu.time}. We’ll send a confirmation shortly. Goodbye.`
      );
    } else {
      twimlResp.say(
        "Thanks for the info. Our team will review and follow up shortly. Goodbye."
      );
    }
    twimlResp.hangup();

    res.type("text/xml").send(twimlResp.toString());
  } catch (err) {
    console.error("Error in recording-handler:", err);
    const fallback = new VoiceResponse();
    fallback.say("Sorry, an error occurred. Please try again later.");
    fallback.hangup();
    res.type("text/xml").send(fallback.toString());
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Voice webhook & transcription listening on port ${PORT}`)
);
