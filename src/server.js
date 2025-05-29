// src/server.js

import express from "express";
import twilio from "twilio";
import axios from "axios";
import FormData from "form-data";

const { VoiceResponse } = twilio.twiml;
const app = express();
app.use(express.urlencoded({ extended: false }));

// In‑memory call context (for prod, swap to Redis)
const callContext = {};

// Helper: call OpenAI chat endpoint
async function askOpenAI(prompt) {
  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o",
      messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
      temperature: 0,
    },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
  );
  return res.data.choices[0].message.content;
}

// 1) Entry point: welcome & first gather
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
    speechTimeout: "auto",
  });
  gather.say("Please briefly state your repair request, including preferred date and time if you know them.");
  twiml.redirect("/voice-webhook"); // fallback to restart
  res.type("text/xml").send(twiml.toString());
});

// 2) Handle initial user request
app.post("/handle-request", async (req, res) => {
  const callSid = req.body.CallSid;
  const transcript = req.body.SpeechResult || "";
  console.log("User said:", transcript);

  // Parse intent + any slots
  const systemPrompt =
    "You are an assistant for scheduling HVAC service. " +
    "Parse the user’s transcript into JSON with keys: intent ('booking' or 'other'), " +
    "date (YYYY-MM-DD or ''), time (HH:MM AM/PM or ''), raw_transcript.";
  const userPrompt = transcript;
  let json;
  try {
    const aiReply = await askOpenAI({ system: systemPrompt, user: userPrompt });
    json = JSON.parse(aiReply);
  } catch (err) {
    console.error("NLU parse error:", err);
    json = { intent: "other", date: "", time: "", raw_transcript: transcript };
  }

  // Initialize context
  callContext[callSid] = { ...json };

  const twiml = new VoiceResponse();
  if (json.intent !== "booking") {
    twiml.say("Got it. Our team will review your request and follow up shortly. Goodbye.");
    twiml.hangup();
  } else if (!json.date) {
    // Ask for date
    const gather = twiml.gather({
      input: "speech",
      action: "/gather-date",
      method: "POST",
      speechTimeout: "auto",
    });
    gather.say("Sure—what date would you like to schedule your service?");
  } else if (!json.time) {
    // Ask for time
    const gather = twiml.gather({
      input: "speech",
      action: "/gather-time",
      method: "POST",
      speechTimeout: "auto",
    });
    gather.say(`Great—what time on ${json.date} works best for you?`);
  } else {
    // All slots present: confirm
    twiml.say(
      `Fantastic! I’ve booked your service for ${json.date} at ${json.time}. ` +
      "We’ll send confirmation via text shortly. Goodbye."
    );
    twiml.hangup();
  }

  res.type("text/xml").send(twiml.toString());
});

// 3) Gather date turn
app.post("/gather-date", async (req, res) => {
  const callSid = req.body.CallSid;
  const said = req.body.SpeechResult || "";
  console.log("Date slot input:", said);

  // Extract absolute date
  const systemPrompt =
    "Convert the following into an absolute date in YYYY-MM-DD format in America/Chicago timezone. " +
    "If you cannot, return an empty string.";
  const aiReply = await askOpenAI({ system: systemPrompt, user: said });
  const date = aiReply.trim();

  callContext[callSid].date = date;

  // Next: time or confirm
  const ctx = callContext[callSid];
  const twiml = new VoiceResponse();
  if (!date) {
    const gather = twiml.gather({
      input: "speech",
      action: "/gather-date",
      method: "POST",
      speechTimeout: "auto",
    });
    gather.say("Sorry, I didn’t catch the date. Please say the date for your appointment.");
  } else {
    const gather = twiml.gather({
      input: "speech",
      action: "/gather-time",
      method: "POST",
      speechTimeout: "auto",
    });
    gather.say(`Thanks—what time on ${date} would you like your HVAC service?`);
  }

  res.type("text/xml").send(twiml.toString());
});

// 4) Gather time turn
app.post("/gather-time", async (req, res) => {
  const callSid = req.body.CallSid;
  const said = req.body.SpeechResult || "";
  console.log("Time slot input:", said);

  // Extract time slot
  const systemPrompt =
    "Convert the following into a time in HH:MM AM/PM format. If you cannot, return an empty string.";
  const aiReply = await askOpenAI({ system: systemPrompt, user: said });
  const time = aiReply.trim();

  callContext[callSid].time = time;

  const ctx = callContext[callSid];
  const twiml = new VoiceResponse();
  if (!time) {
    const gather = twiml.gather({
      input: "speech",
      action: "/gather-time",
      method: "POST",
      speechTimeout: "auto",
    });
    gather.say("Sorry, I didn’t catch the time. Please say the time for your appointment.");
  } else {
    twiml.say(
      `All set! Your HVAC service is scheduled for ${ctx.date} at ${time}. Thank you! Goodbye.`
    );
    // TODO: call your Scheduler Agent / Google Calendar API here
    twiml.hangup();
  }

  res.type("text/xml").send(twiml.toString());
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Multi‑turn voice assistant listening on port ${PORT}`)
);
