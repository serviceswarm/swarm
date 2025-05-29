// src/server.js
import express from "express";
import { twiml } from "twilio";
const { VoiceResponse } = twiml;

const app = express();
app.use(express.urlencoded({ extended: false }));

app.post("/voice-webhook", (req, res) => {
  console.log("Incoming call from:", req.body.From);
  console.log("To:", req.body.To);

  const twiml = new VoiceResponse();
  twiml.say(
    { voice: "Polly.Joanna", language: "en-US" },
    "Hello! Thank you for calling ServiceSwarm. Please hold while we connect you."
  );

  res.type("text/xml");
  res.send(twiml.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Voice webhook listening on port ${PORT}`)
);
