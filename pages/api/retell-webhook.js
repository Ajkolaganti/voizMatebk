import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';

// Initialize Gmail API
const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

// Create email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    type: 'OAuth2',
    user: process.env.GMAIL_EMAIL,
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    refreshToken: process.env.GMAIL_REFRESH_TOKEN,
  },
});

// Helper function to log with timestamp
const log = (level, message, data = {}) => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...data
  };
  console.log(JSON.stringify(logEntry));
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    log('error', 'Method not allowed', { method: req.method });
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    log('info', 'Received webhook request', { 
      body: req.body,
      headers: req.headers
    });

    const { call_metadata } = req.body;
    if (!call_metadata) {
      log('error', 'Missing call_metadata in request');
      return res.status(400).json({ error: 'Missing call_metadata' });
    }

    const { caller_number, agent_number, call_duration, call_status, call_id } = call_metadata;
    log('info', 'Processing call metadata', { 
      caller_number,
      agent_number,
      call_duration,
      call_status,
      call_id
    });

    // Read contacts from JSON file
    const contactsPath = path.join(process.cwd(), 'data', 'contacts.json');
    let contacts;
    try {
      const contactsData = fs.readFileSync(contactsPath, 'utf8');
      contacts = JSON.parse(contactsData);
      log('info', 'Successfully loaded contacts', { 
        contactCount: contacts.length 
      });
    } catch (error) {
      log('error', 'Failed to read contacts file', { 
        error: error.message,
        path: contactsPath
      });
      return res.status(500).json({ error: 'Failed to read contacts file' });
    }

    // Find matching contact
    const contact = contacts.find(c => c.phone === caller_number);
    if (!contact) {
      log('warn', 'No matching contact found', { 
        caller_number 
      });
      return res.status(404).json({ error: 'Contact not found' });
    }

    log('info', 'Found matching contact', { 
      contact: {
        name: contact.name,
        phone: contact.phone,
        email: contact.email
      }
    });

    // Prepare email content
    const emailContent = `
      Call Summary:
      Caller: ${contact.name} (${caller_number})
      Agent: ${agent_number}
      Duration: ${call_duration} seconds
      Status: ${call_status}
      Call ID: ${call_id}
    `;

    // Send email
    try {
      const mailOptions = {
        from: process.env.GMAIL_EMAIL,
        to: contact.email,
        subject: `Call Summary - ${call_id}`,
        text: emailContent,
      };

      log('info', 'Sending email', { 
        to: contact.email,
        subject: mailOptions.subject
      });

      await transporter.sendMail(mailOptions);
      log('info', 'Email sent successfully', { 
        to: contact.email,
        call_id 
      });

      return res.status(200).json({ 
        message: 'Email sent successfully',
        contact: {
          name: contact.name,
          email: contact.email
        }
      });
    } catch (error) {
      log('error', 'Failed to send email', { 
        error: error.message,
        to: contact.email,
        call_id
      });
      return res.status(500).json({ error: 'Failed to send email' });
    }
  } catch (error) {
    log('error', 'Unexpected error in webhook handler', { 
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
} 