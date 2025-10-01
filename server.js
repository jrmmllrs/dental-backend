// server.js - With Supabase Token Storage
require("dotenv").config();
const express = require("express");
const { google } = require("googleapis");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const cors = require("cors");

const cors = require("cors");

app.use(
  cors({
    origin: [
      "http://localhost:5173", // local dev
      "https://dental-frontend-six-kappa.vercel.app", // production frontend
    ],
    credentials: true,
  })
);

app.use(cookieParser());
app.use(
  cors({
    origin: "https://dental-frontend-six-kappa.vercel.app",
    credentials: true,
  })
);


// Import Supabase token storage
const {
  loadSharedCalendarTokens,
  saveSharedCalendarTokens,
} = require('./supabase-token-storage');

const app = express();

// Admin emails
const ADMIN_EMAILS = [
  "jmillares0945@gmail.com",
  "admin@dentalclinic.com",
  "doctor@dentalclinic.com",
];

// Shared calendar configuration
const SHARED_CALENDAR_ID =
  "f35ef0ed2691595932ffe57ccb43470d2c1115d1783b09ecb167aaec14d29681@group.calendar.google.com";

// Store credentials in memory
let sharedCalendarTokens = null;
let sharedCalendarClient = null;

// Middleware
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(cookieParser());
app.use(bodyParser.json());

// OAuth2 Clients
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const sharedOAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

// Helper: Check if user is admin
const isUserAdmin = (email) => {
  return ADMIN_EMAILS.includes(email?.toLowerCase());
};

// Helper: Refresh tokens if needed
async function refreshTokensIfNeeded(client, tokens) {
  try {
    if (!tokens.refresh_token) {
      console.error("❌ No refresh token available");
      return null;
    }

    const now = Date.now();
    const expiryDate = tokens.expiry_date || 0;

    if (expiryDate - now < 5 * 60 * 1000) {
      console.log("🔄 Refreshing expired token...");
      client.setCredentials(tokens);

      const { credentials } = await client.refreshAccessToken();

      if (!credentials.refresh_token && tokens.refresh_token) {
        credentials.refresh_token = tokens.refresh_token;
      }

      console.log("✅ Token refreshed successfully");
      return credentials;
    }

    return tokens;
  } catch (err) {
    console.error("❌ Token refresh error:", err.message);
    return null;
  }
}

// Helper: Load saved tokens from Supabase
async function loadSharedCalendarTokensFromDB() {
  try {
    const saved = await loadSharedCalendarTokens();

    if (saved && saved.tokens && saved.tokens.access_token) {
      console.log(`📂 Loading tokens for ${saved.userEmail}...`);

      sharedOAuth2Client.setCredentials(saved.tokens);
      sharedCalendarTokens = saved.tokens;

      const refreshed = await refreshTokensIfNeeded(
        sharedOAuth2Client,
        saved.tokens
      );

      if (refreshed === null) {
        console.error("❌ Token refresh failed. Admin needs to re-authenticate.");
        sharedCalendarTokens = null;
        sharedCalendarClient = null;
        return false;
      } else if (refreshed !== saved.tokens) {
        console.log("✅ Tokens refreshed and saved to Supabase");
        sharedCalendarTokens = refreshed;
        sharedOAuth2Client.setCredentials(refreshed);
        await saveSharedCalendarTokens(refreshed, saved.userEmail);
      }

      sharedCalendarClient = google.calendar({
        version: "v3",
        auth: sharedOAuth2Client,
      });

      console.log(`✅ Shared calendar loaded (Admin: ${saved.userEmail})`);
      return true;
    }
  } catch (err) {
    console.error("❌ Error loading tokens:", err.message);
  }
  return false;
}

// Helper: Set credentials from cookies
async function setCredentialsFromCookies(req) {
  const cookie = req.cookies.tokens;
  if (!cookie) return false;
  try {
    const tokens = JSON.parse(cookie);

    try {
      const refreshed = await refreshTokensIfNeeded(oauth2Client, tokens);
      if (refreshed !== tokens) {
        oauth2Client.setCredentials(refreshed);
        return refreshed;
      }
    } catch (refreshErr) {
      console.error("Cookie token refresh failed:", refreshErr.message);
    }

    oauth2Client.setCredentials(tokens);
    return true;
  } catch (err) {
    return false;
  }
}

// Helper: Get user info
async function getUserInfo() {
  try {
    const oauth2 = google.oauth2({ auth: oauth2Client, version: "v2" });
    const userinfo = await oauth2.userinfo.get();
    return {
      ...userinfo.data,
      role: isUserAdmin(userinfo.data.email) ? "admin" : "patient",
    };
  } catch (err) {
    console.error("Error getting user info:", err.message);
    return null;
  }
}

// Helper: Get shared calendar client with auto-refresh
async function getSharedCalendarClient() {
  if (!sharedCalendarClient || !sharedCalendarTokens) {
    return null;
  }

  try {
    const refreshed = await refreshTokensIfNeeded(
      sharedOAuth2Client,
      sharedCalendarTokens
    );

    if (refreshed === null) {
      console.error("❌ Shared calendar tokens invalid. Admin must re-authenticate.");
      sharedCalendarTokens = null;
      sharedCalendarClient = null;
      return null;
    } else if (refreshed !== sharedCalendarTokens) {
      sharedCalendarTokens = refreshed;
      sharedOAuth2Client.setCredentials(refreshed);

      // Save refreshed tokens to Supabase
      try {
        const saved = await loadSharedCalendarTokens();
        if (saved && saved.userEmail) {
          await saveSharedCalendarTokens(refreshed, saved.userEmail);
        }
      } catch (err) {
        console.error("⚠️  Could not save refreshed tokens:", err.message);
      }
    }

    return sharedCalendarClient;
  } catch (err) {
    console.error("❌ Error accessing shared calendar:", err.message);
    return null;
  }
}

// Helper: Convert 12-hour to 24-hour format
function convertTo24Hour(time12h) {
  if (!time12h) return "09:00";

  if (/^\d{2}:\d{2}$/.test(time12h)) {
    return time12h;
  }

  const [time, modifier] = time12h.trim().split(" ");
  let [hours, minutes] = time.split(":");

  hours = parseInt(hours, 10);

  if (modifier && modifier.toUpperCase() === "PM" && hours !== 12) {
    hours += 12;
  } else if (modifier && modifier.toUpperCase() === "AM" && hours === 12) {
    hours = 0;
  }

  return `${hours.toString().padStart(2, "0")}:${minutes}`;
}

// Helper: Format appointment
function formatAppointmentForCalendar(appointment, bookedByEmail) {
  const time24 = convertTo24Hour(appointment.time);
  const startDateTime = new Date(`${appointment.date}T${time24}:00`);
  const endDateTime = new Date(startDateTime.getTime() + 30 * 60 * 1000);

  const reasonLabels = {
    checkup: "Regular Checkup",
    cleaning: "Teeth Cleaning",
    filling: "Dental Filling",
    extraction: "Tooth Extraction",
    emergency: "Emergency Visit",
    consultation: "Consultation",
    other: "Dental Appointment",
  };

  return {
    summary: `${reasonLabels[appointment.reason] || "Dental Appointment"} - ${
      appointment.patientName
    }`,
    description: `
Patient: ${appointment.patientName}
Email: ${appointment.patientEmail}
Phone: ${appointment.patientPhone}
Reason: ${reasonLabels[appointment.reason] || appointment.reason}
Status: ${appointment.status}
BookedByEmail: ${bookedByEmail}
${appointment.notes ? `Notes: ${appointment.notes}` : ""}
    `.trim(),
    start: {
      dateTime: startDateTime.toISOString(),
      timeZone: "America/New_York",
    },
    end: {
      dateTime: endDateTime.toISOString(),
      timeZone: "America/New_York",
    },
    attendees: [{ email: appointment.patientEmail }, { email: bookedByEmail }],
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 24 * 60 },
        { method: "email", minutes: 60 },
      ],
    },
  };
}

// 1. Get OAuth URL
app.get("/auth/url", (req, res) => {
  try {
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES,
    });
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: "Failed to generate auth URL" });
  }
});

// 2. OAuth callback
app.get("/oauth2callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) throw new Error("No code provided");

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ auth: oauth2Client, version: "v2" });
    const userinfo = await oauth2.userinfo.get();
    const userEmail = userinfo.data.email;
    const isAdmin = isUserAdmin(userEmail);

    console.log(`User: ${userEmail} (${isAdmin ? "ADMIN" : "Patient"})`);

    // Initialize shared calendar for admin
    if (isAdmin) {
      console.log("Initializing shared calendar...");
      sharedCalendarTokens = tokens;
      sharedOAuth2Client.setCredentials(tokens);
      sharedCalendarClient = google.calendar({
        version: "v3",
        auth: sharedOAuth2Client,
      });
      
      // Save to Supabase
      await saveSharedCalendarTokens(tokens, userEmail);
      console.log("✅ Shared calendar initialized and saved to Supabase");
    }

    res.cookie("tokens", JSON.stringify(tokens), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    });

    const frontend = process.env.CLIENT_ORIGIN || "http://localhost:5173";
    res.redirect(`${frontend}/?auth=success`);
  } catch (err) {
    console.error("OAuth error:", err.message);
    res.status(500).send("Authentication failed");
  }
});

// 3. Logout
app.post("/auth/logout", (req, res) => {
  try {
    res.clearCookie("tokens", { path: "/" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// 4. Get user info
app.get("/api/me", async (req, res) => {
  try {
    const refreshedTokens = await setCredentialsFromCookies(req);
    if (!refreshedTokens) {
      return res.json({ authenticated: false });
    }

    if (typeof refreshedTokens === "object") {
      res.cookie("tokens", JSON.stringify(refreshedTokens), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: "lax",
      });
    }

    const user = await getUserInfo();
    if (!user) {
      return res.json({ authenticated: false });
    }

    res.json({ authenticated: true, user });
  } catch (err) {
    res.json({ authenticated: false });
  }
});

// 5. Get appointments
app.get("/api/appointments", async (req, res) => {
  try {
    const refreshedTokens = await setCredentialsFromCookies(req);
    if (!refreshedTokens) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await getUserInfo();
    if (!user) {
      return res.status(401).json({ error: "User info not available" });
    }

    const calendar = await getSharedCalendarClient();
    if (!calendar) {
      return res.status(503).json({
        error: "Shared calendar not available",
        message: "Please ensure an admin has authenticated to enable shared calendar access",
      });
    }

    try {
      const response = await calendar.events.list({
        calendarId: SHARED_CALENDAR_ID,
        timeMin: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        timeMax: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        maxResults: 100,
        singleEvents: true,
        orderBy: "startTime",
      });

      const events = response.data.items || [];

      const appointments = events
        .filter((event) => {
          const summary = (event.summary || "").toLowerCase();
          const description = (event.description || "").toLowerCase();
          return (
            summary.includes("dental") ||
            summary.includes("checkup") ||
            summary.includes("cleaning") ||
            summary.includes("appointment") ||
            description.includes("patient:") ||
            description.includes("bookedbyemail:")
          );
        })
        .map((event) => {
          const description = event.description || "";
          const lines = description
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line);

          const getFieldValue = (fieldName) => {
            const line = lines.find((line) =>
              line.toLowerCase().startsWith(fieldName.toLowerCase() + ":")
            );
            return line ? line.split(":").slice(1).join(":").trim() : "";
          };

          const patientName = getFieldValue("Patient") || "Unknown Patient";
          const patientEmail = getFieldValue("Email") || "";
          const patientPhone = getFieldValue("Phone") || "";
          const reasonText = getFieldValue("Reason") || "other";
          const statusText = getFieldValue("Status") || "pending";
          const notes = getFieldValue("Notes") || "";
          const bookedByEmail = getFieldValue("BookedByEmail") || patientEmail;

          const reasonMapping = {
            "regular checkup": "checkup",
            "teeth cleaning": "cleaning",
            "dental filling": "filling",
            "tooth extraction": "extraction",
            "emergency visit": "emergency",
            consultation: "consultation",
          };

          const reason =
            reasonMapping[reasonText.toLowerCase()] || reasonText.toLowerCase();

          let status = statusText.toLowerCase();
          const eventTitle = (event.summary || "").toLowerCase();

          if (eventTitle.includes("[pending]")) status = "pending";
          else if (eventTitle.includes("[declined]")) status = "declined";
          else if (eventTitle.includes("[confirmed]")) status = "confirmed";

          const startDate = new Date(event.start.dateTime || event.start.date);
          const date = startDate.toISOString().split("T")[0];
          const time = event.start.dateTime
            ? startDate.toLocaleTimeString("en-US", {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
              })
            : "09:00";

          return {
            id: event.id,
            googleEventId: event.id,
            patientName,
            patientEmail,
            patientPhone,
            date,
            time,
            reason,
            status,
            notes,
            bookedByEmail,
          };
        });

      let filteredAppointments = appointments;
      if (user.role !== "admin") {
        filteredAppointments = appointments.filter((apt) => {
          const bookedByMatch =
            apt.bookedByEmail &&
            apt.bookedByEmail.toLowerCase() === user.email.toLowerCase();
          const emailMatch =
            apt.patientEmail.toLowerCase() === user.email.toLowerCase();
          return bookedByMatch || emailMatch;
        });
      }

      res.json({ appointments: filteredAppointments });
    } catch (calendarError) {
      console.error("Calendar error:", calendarError.message);

      if (calendarError.code === 401 || calendarError.code === 403) {
        return res.status(503).json({
          error: "Shared calendar access denied",
          message: "An admin needs to authenticate first",
        });
      }

      throw calendarError;
    }
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 6. Create appointment
app.post("/api/appointments", async (req, res) => {
  try {
    const refreshedTokens = await setCredentialsFromCookies(req);
    if (!refreshedTokens) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await getUserInfo();
    if (!user) {
      return res.status(401).json({ error: "User info not available" });
    }

    const calendar = await getSharedCalendarClient();
    if (!calendar) {
      return res.status(503).json({
        error: "Cannot create appointment",
        message: "Shared calendar not available. Please contact an administrator.",
      });
    }

    const appointmentData = req.body;
    appointmentData.status = user.role === "admin" ? "confirmed" : "pending";

    const event = formatAppointmentForCalendar(appointmentData, user.email);

    if (appointmentData.status === "pending") {
      event.summary = `[PENDING] ${event.summary}`;
    } else if (appointmentData.status === "confirmed") {
      event.summary = `[CONFIRMED] ${event.summary}`;
    }

    try {
      const response = await calendar.events.insert({
        calendarId: SHARED_CALENDAR_ID,
        resource: event,
        sendUpdates: "all",
      });

      res.json({
        success: true,
        message:
          user.role === "admin"
            ? "Appointment confirmed and added to calendar"
            : "Appointment request sent for admin approval",
        appointment: {
          id: response.data.id,
          ...appointmentData,
        },
      });
    } catch (calendarError) {
      console.error("Creation error:", calendarError.message);
      return res.status(503).json({
        error: "Cannot create appointment",
        message: calendarError.message || "Calendar access issue",
      });
    }
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 7. Update appointment status
app.put("/api/appointments/:id/status", async (req, res) => {
  try {
    const refreshedTokens = await setCredentialsFromCookies(req);
    if (!refreshedTokens) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await getUserInfo();
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { id } = req.params;
    const { status } = req.body;

    if (!["confirmed", "declined", "pending"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const calendar = await getSharedCalendarClient();
    if (!calendar) {
      return res.status(503).json({
        error: "Cannot update appointment",
        message: "Shared calendar not available",
      });
    }

    try {
      const event = await calendar.events.get({
        calendarId: SHARED_CALENDAR_ID,
        eventId: id,
      });

      let updatedSummary = event.data.summary || "";
      let updatedDescription = event.data.description || "";

      updatedSummary = updatedSummary
        .replace(/^\[PENDING\]\s*/i, "")
        .replace(/^\[DECLINED\]\s*/i, "")
        .replace(/^\[CONFIRMED\]\s*/i, "");

      const statusPrefixes = {
        pending: "[PENDING]",
        declined: "[DECLINED]",
        confirmed: "[CONFIRMED]",
      };

      updatedSummary = `${statusPrefixes[status]} ${updatedSummary}`;

      if (updatedDescription.includes("Status:")) {
        updatedDescription = updatedDescription.replace(
          /Status:\s*\w+/i,
          `Status: ${status}`
        );
      } else {
        updatedDescription += `\nStatus: ${status}`;
      }

      const updatedEvent = {
        ...event.data,
        summary: updatedSummary,
        description: updatedDescription,
      };

      const response = await calendar.events.update({
        calendarId: SHARED_CALENDAR_ID,
        eventId: id,
        resource: updatedEvent,
        sendUpdates: "all",
      });

      res.json({
        success: true,
        message: `Appointment ${status} successfully`,
        appointment: {
          id: response.data.id,
          status: status,
          summary: updatedSummary,
        },
      });
    } catch (eventError) {
      console.error("Update error:", eventError.message);
      if (eventError.code === 404) {
        return res.status(404).json({ error: "Appointment not found" });
      }
      return res.status(500).json({
        error: "Failed to update appointment",
        details: eventError.message,
      });
    }
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 8. Delete appointment
app.delete("/api/appointments/:id", async (req, res) => {
  try {
    const refreshedTokens = await setCredentialsFromCookies(req);
    if (!refreshedTokens) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await getUserInfo();
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { id } = req.params;

    const calendar = await getSharedCalendarClient();
    if (!calendar) {
      return res.status(503).json({
        error: "Cannot delete appointment",
        message: "Shared calendar not available",
      });
    }

    try {
      await calendar.events.delete({
        calendarId: SHARED_CALENDAR_ID,
        eventId: id,
        sendUpdates: "all",
      });

      res.json({
        success: true,
        message: "Appointment deleted successfully",
      });
    } catch (eventError) {
      console.error("Delete error:", eventError.message);
      if (eventError.code === 404) {
        return res.status(404).json({ error: "Appointment not found" });
      }
      return res.status(500).json({
        error: "Failed to delete appointment",
        details: eventError.message,
      });
    }
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 9. Get available slots
app.get("/api/appointments/slots/:date", async (req, res) => {
  try {
    const refreshedTokens = await setCredentialsFromCookies(req);
    if (!refreshedTokens) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await getUserInfo();
    if (!user) {
      return res.status(401).json({ error: "User info not available" });
    }

    const { date } = req.params;

    const calendar = await getSharedCalendarClient();
    if (!calendar) {
      const allSlots = [
        "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
        "14:00", "14:30", "15:00", "15:30", "16:00", "16:30",
      ];

      return res.json({
        date,
        availableSlots: allSlots,
        bookedSlots: [],
        warning: "Calendar unavailable, showing all slots",
      });
    }

    const startOfDay = new Date(`${date}T00:00:00`);
    const endOfDay = new Date(`${date}T23:59:59`);

    try {
      const response = await calendar.events.list({
        calendarId: SHARED_CALENDAR_ID,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
      });

      const events = response.data.items || [];
      const bookedSlots = events
        .filter((event) => {
          if (!event.start.dateTime) return false;

          const summary = (event.summary || "").toLowerCase();
          const description = (event.description || "").toLowerCase();

          if (summary.includes("[declined]")) return false;
          if (description.includes("status: declined")) return false;

          return true;
        })
        .map((event) => {
          const startTime = new Date(event.start.dateTime);
          return startTime.toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
          });
        });

      const allSlots = [
        "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
        "14:00", "14:30", "15:00", "15:30", "16:00", "16:30",
      ];

      const availableSlots = allSlots.filter(
        (slot) => !bookedSlots.includes(slot)
      );

      res.json({
        date,
        availableSlots,
        bookedSlots,
      });
    } catch (calendarError) {
      console.error("Slots error:", calendarError.message);

      const allSlots = [
        "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
        "14:00", "14:30", "15:00", "15:30", "16:00", "16:30",
      ];

      res.json({
        date,
        availableSlots: allSlots,
        bookedSlots: [],
        warning: "Could not check availability",
      });
    }
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 10. Calendar status
app.get("/api/calendar/status", async (req, res) => {
  res.json({
    sharedCalendarConfigured: !!sharedCalendarTokens,
    sharedCalendarId: SHARED_CALENDAR_ID,
    adminEmails: ADMIN_EMAILS,
    message: sharedCalendarTokens
      ? "Shared calendar is ready"
      : "Admin needs to authenticate first",
  });
});

// 11. Debug endpoint
app.get("/api/debug/status", async (req, res) => {
  try {
    const tokenData = await loadSharedCalendarTokens();
    
    res.json({
      supabase: {
        connected: true,
        hasData: !!tokenData,
        userEmail: tokenData?.userEmail || null,
        savedAt: tokenData?.savedAt || null,
      },
      memory: {
        hasTokens: !!sharedCalendarTokens,
        hasClient: !!sharedCalendarClient,
      },
      config: {
        calendarId: SHARED_CALENDAR_ID,
        adminEmails: ADMIN_EMAILS,
      },
    });
  } catch (err) {
    res.json({
      supabase: {
        connected: false,
        error: err.message,
      },
      memory: {
        hasTokens: !!sharedCalendarTokens,
        hasClient: !!sharedCalendarClient,
      },
      config: {
        calendarId: SHARED_CALENDAR_ID,
        adminEmails: ADMIN_EMAILS,
      },
    });
  }
});

// Start server
// const PORT = process.env.PORT || 4000;
// app.listen(PORT, async () => {
//   console.log("\n" + "=".repeat(60));
//   console.log(`Server: http://localhost:${PORT}`);
//   console.log("=".repeat(60));

//   if (await loadSharedCalendarTokensFromDB()) {
//     console.log("\n✅ Shared calendar ready (loaded from Supabase)");
//   } else {
//     console.log("\n⚠️  Admin login required");
//     console.log(`   Admins: ${ADMIN_EMAILS.join(", ")}`);
//   }

//   console.log("\nDebug: http://localhost:4000/api/debug/status");
//   console.log("=".repeat(60) + "\n");
// });

module.exports = app;
