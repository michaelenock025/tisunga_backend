// src/routes/event.routes.js

const express = require("express");
const router = express.Router();

// GET all events (placeholder)
router.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Event route is working",
    data: [],
  });
});

// GET single event (placeholder)
router.get("/:id", (req, res) => {
  res.json({
    success: true,
    message: `Event ${req.params.id} fetched successfully`,
  });
});

// CREATE event (placeholder)
router.post("/", (req, res) => {
  res.json({
    success: true,
    message: "Event created successfully",
    body: req.body,
  });
});

module.exports = router;