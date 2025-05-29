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

// 2) Handle the recording callback
app.post("/recording-handler", async (req, res) => {
  try {
    const recordingUrl = req.body.RecordingUrl + ".wav";
    console.log("Recording available at:", recordingUrl);

    // Download the WAV from Twilio
    const audioRes = await axios.get(recordingUrl, { responseType: "stream" });
    const form = new FormData();
    form.append("file", audioRes.data, "recording.wav");
    form.append("model", "whisper-1");

    // Send to OpenAI Whisper
    const openaiRes = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    const transcript = openaiRes.data.text;
    console.log("Transcription:", transcript);

    // Read back the transcript and hang up
    const twimlResp = new VoiceResponse();
    twimlResp.say(
      { voice: "Polly.Joanna", language: "en-US" },
      `You said: ${transcript}. Thank you. Goodbye.`
    );
    twimlResp.hangup();

    res.type("text/xml");
    res.send(twimlResp.toString());
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
