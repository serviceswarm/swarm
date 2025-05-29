// src/server.js

import express from "express";
import twilio from "twilio";
import axios from "axios";

const { VoiceResponse } = twilio.twiml;
const app = express();
app.use(express.urlencoded({ extended: false }));

// In‑memory call context (for demo; replace with Redis/DB in prod)
const callContext = {};

// Helper to call OpenAI Chat API
async function askOpenAI({ system, user }) {
  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      temperature: 0
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );
  return res.data.choices[0].message.content;
}

// 0) GET fallback so Twilio’s test pings don’t 404
app.get("/voice-webhook", (req, res) => {
  const twiml = new VoiceResponse();
  twiml.say(
    { voice: "Polly.Joanna", language: "en-US" },
    "ServiceSwarm is online and ready to handle calls."
  );
  res.type("text/xml").send(twiml.toString());
});

// 1) Entry point: welcome & gather initial request
app.post("/voice-webhook", (req, res) => {
  const twiml = new VoiceResponse();
  twiml.say(
    { voice: "Polly.Joanna" },
    "Hello, you’ve reached ServiceSwarm HVAC repair. How can I help you today?"
  );
  const gather = twiml.gather({
    input: "speech",
    action: "/handle-request",
    method: "POST",
    speechTimeout: "auto"
  });
  gather.say(
    "Please briefly state your repair request, including preferred date and time if you know them."
  );
  twiml.redirect("/voice-webhook"); // fallback
  res.type("text/xml").send(twiml.toString());
});

// 2) Handle the initial user request
app.post("/handle-request", async (req, res) => {
  const callSid = req.body.CallSid;
  const transcript = req.body.SpeechResult || "";
  console.log("User said:", transcript);

  // NLU prompt: parse intent & slots
  const systemPrompt =
    "You are an assistant for scheduling HVAC service. " +
    "Parse the transcript into JSON with keys: intent ('booking' or 'other'), " +
    "date (YYYY-MM-DD or ''), time (HH:MM AM/PM or ''), raw_transcript.";
  let json;
  try {
    const aiReply = await askOpenAI({ system: systemPrompt, user: transcript });
    json = JSON.parse(aiReply);
  } catch (err) {
    console.error("NLU parse error:", err);
    json = { intent: "other", date: "", time: "", raw_transcript: transcript };
  }

  // Save context
  callContext[callSid] = { ...json };

  const twiml = new VoiceResponse();
  if (json.intent !== "booking") {
    twiml.say(
      "Got it. Our team will review your request and follow up shortly. Goodbye."
    );
    twiml.hangup();
  } else if (!json.date) {
    const gather = twiml.gather({
      input: "speech",
      action: "/gather-date",
      method: "POST",
      speechTimeout: "auto"
    });
    gather.say("Sure—what date would you like to schedule your service?");
  } else if (!json.time) {
    const gather = twiml.gather({
      input: "speech",
      action: "/gather-time",
      method: "POST",
      speechTimeout: "auto"
    });
    gather.say(`Great—what time on ${json.date} works best for you?`);
  } else {
    twiml.say(
      `Fantastic! I’ve booked your service for ${json.date} at ${json.time}. ` +
      "We’ll send confirmation via text shortly. Goodbye."
    );
    twiml.hangup();
    // TODO: call your Scheduler Agent / Google Calendar here
  }

  res.type("text/xml").send(twiml.toString());
});

// 3) Gather date slot
app.post("/gather-date", async (req, res) => {
  const callSid = req.body.CallSid;
  const said = req.body.SpeechResult || "";
  console.log("Date slot input:", said);

  const systemPrompt =
    "Convert the following into an absolute date in YYYY-MM-DD format in America/Chicago timezone. " +
    "If you cannot, return an empty string.";
  let date;
  try {
    const aiReply = await askOpenAI({ system: systemPrompt, user: said });
    date = aiReply.trim();
  } catch (err) {
    console.error("Date parse error:", err);
    date = "";
  }
  callContext[callSid].date = date;

  const twiml = new VoiceResponse();
  if (!date) {
    const gather = twiml.gather({
      input: "speech",
      action: "/gather-date",
      method: "POST",
      speechTimeout: "auto"
    });
    gather.say("Sorry, I didn’t catch the date. Please say the date for your appointment.");
  } else {
    const gather = twiml.gather({
      input: "speech",
      action: "/gather-time",
      method: "POST",
      speechTimeout: "auto"
    });
    gather.say(`Thanks—what time on ${date} would you like your HVAC service?`);
  }

  res.type("text/xml").send(twiml.toString());
});

// 4) Gather time slot
app.post("/gather-time", async (req, res) => {
  const callSid = req.body.CallSid;
  const said = req.body.SpeechResult || "";
  console.log("Time slot input:", said);

  const systemPrompt =
    "Convert the following into a time in HH:MM AM/PM format. If you cannot, return an empty string.";
  let time;
  try {
    const aiReply = await askOpenAI({ system: systemPrompt, user: said });
    time = aiReply.trim();
  } catch (err) {
    console.error("Time parse error:", err);
    time = "";
  }
  callContext[callSid].time = time;
  const ctx = callContext[callSid];

  const twiml = new VoiceResponse();
  if (!time) {
    const gather = twiml.gather({
      input: "speech",
      action: "/gather-time",
      method: "POST",
      speechTimeout: "auto"
    });
    gather.say("Sorry, I didn’t catch the time. Please say the time for your appointment.");
  } else {
    twiml.say(
      `All set! Your HVAC service is scheduled for ${ctx.date} at ${time}. Thank you! Goodbye.`
    );
    twiml.hangup();
    // TODO: integrate Scheduler Agent / CRM here
  }

  res.type("text/xml").send(twiml.toString());
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Multi‑turn voice assistant listening on port ${PORT}`)
);
