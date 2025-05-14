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

// Helper function to format duration
const formatDuration = (ms) => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
};

// Helper function to format cost
const formatCost = (cost) => {
  return `$${cost.toFixed(2)}`;
};

// Helper function to format timestamp
const formatTimestamp = (timestamp) => {
  return new Date(timestamp).toLocaleString();
};

// Validate Gmail configuration
const validateGmailConfig = () => {
  const requiredEnvVars = [
    'GMAIL_CLIENT_ID',
    'GMAIL_CLIENT_SECRET',
    'GMAIL_REFRESH_TOKEN',
    'GMAIL_EMAIL'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    log('error', 'Missing required Gmail environment variables', {
      missing: missingVars
    });
    return false;
  }

  return true;
};

// Create email transporter with validation
const createTransporter = () => {
  if (!validateGmailConfig()) {
    throw new Error('Invalid Gmail configuration');
  }

  log('info', 'Creating Gmail transporter', {
    email: process.env.GMAIL_EMAIL,
    has_client_id: !!process.env.GMAIL_CLIENT_ID,
    has_client_secret: !!process.env.GMAIL_CLIENT_SECRET,
    has_refresh_token: !!process.env.GMAIL_REFRESH_TOKEN
  });

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: process.env.GMAIL_EMAIL,
      clientId: process.env.GMAIL_CLIENT_ID,
      clientSecret: process.env.GMAIL_CLIENT_SECRET,
      refreshToken: process.env.GMAIL_REFRESH_TOKEN,
    },
  });
};

export default async function handler(req, res) {
  // Handle GET requests with a helpful message
  if (req.method === 'GET') {
    log('info', 'Received GET request', { 
      path: req.url,
      query: req.query,
      headers: req.headers
    });
    
    return res.status(200).json({
      status: 'ok',
      message: 'This is a webhook endpoint for Retell Voice Agent. Please use POST method to send call data.',
      usage: {
        method: 'POST',
        endpoint: '/api/retell-webhook',
        requiredFields: ['event', 'call'],
        example: {
          event: 'call_ended',
          call: {
            call_id: 'unique-call-id',
            call_type: 'web_call',
            call_status: 'ended',
            duration_ms: 30000,
            transcript: 'Call transcript here...'
          }
        }
      }
    });
  }

  // Only allow POST requests for actual webhook calls
  if (req.method !== 'POST') {
    log('error', 'Method not allowed', { 
      method: req.method,
      allowedMethods: ['POST', 'GET'],
      path: req.url
    });
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Only POST and GET methods are supported',
      allowedMethods: ['POST', 'GET']
    });
  }

  try {
    log('info', 'Received webhook request', { 
      body: req.body,
      headers: req.headers
    });

    const { event, call } = req.body;
    
    // Validate required fields
    if (!event || !call) {
      log('error', 'Missing required fields', {
        body: req.body
      });
      return res.status(400).json({ 
        error: 'Missing required fields',
        message: 'The request body must include event and call objects',
        example: {
          event: 'call_ended',
          call: {
            call_id: 'unique-call-id',
            call_type: 'web_call',
            call_status: 'ended',
            duration_ms: 30000
          }
        }
      });
    }

    // Only process call_ended events
    if (event !== 'call_ended') {
      log('info', 'Ignoring non-call_ended event', { event });
      return res.status(200).json({ 
        message: 'Event received but not processed',
        event
      });
    }

    const {
      call_id,
      call_type,
      call_status,
      duration_ms,
      transcript,
      recording_url,
      public_log_url,
      start_timestamp,
      end_timestamp,
      disconnection_reason,
      call_cost
    } = call;

    log('info', 'Processing call event', { 
      call_id,
      call_type,
      call_status,
      duration_ms,
      has_transcript: !!transcript,
      has_recording: !!recording_url,
      has_log: !!public_log_url,
      disconnection_reason,
      call_cost
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
      return res.status(500).json({ 
        error: 'Failed to read contacts file',
        message: 'Internal server error while accessing contacts database'
      });
    }

    // For now, we'll send the email to a default contact since we don't have caller number
    // In a real implementation, you would need to map the call to a contact
    const defaultContact = contacts[0]; // Using first contact as default
    if (!defaultContact) {
      log('error', 'No contacts found in database');
      return res.status(500).json({ 
        error: 'No contacts configured',
        message: 'Please add at least one contact to the database'
      });
    }

    // Prepare email content with enhanced formatting
    const emailContent = `
📞 Call Summary
==============

📋 Call Details
--------------
Call ID: ${call_id}
Type: ${call_type}
Status: ${call_status}
Duration: ${formatDuration(duration_ms)}
Started: ${formatTimestamp(start_timestamp)}
Ended: ${formatTimestamp(end_timestamp)}
Disconnection Reason: ${disconnection_reason || 'Not specified'}

💰 Cost Breakdown
---------------
${call_cost ? `
Total Cost: ${formatCost(call_cost.combined_cost)}
Duration Cost: ${formatCost(call_cost.total_duration_unit_price)}
Product Costs:
${call_cost.product_costs.map(cost => `- ${cost.product}: ${formatCost(cost.cost)}`).join('\n')}
` : 'No cost information available'}

${transcript ? `
📝 Transcript
-----------
${transcript}
` : ''}

🔗 Links
-------
${recording_url ? `Recording: ${recording_url}` : ''}
${public_log_url ? `Call Log: ${public_log_url}` : ''}

---
This is an automated message from your Retell Voice Agent.
`;

    // Send email
    try {
      // Create transporter with validation
      const transporter = createTransporter();

      const mailOptions = {
        from: process.env.GMAIL_EMAIL,
        to: defaultContact.email,
        subject: `📞 Call Summary - ${call_id}`,
        text: emailContent,
      };

      log('info', 'Preparing to send email', { 
        to: defaultContact.email,
        subject: mailOptions.subject,
        call_id,
        content_length: emailContent.length
      });

      // Log email configuration (excluding sensitive data)
      log('debug', 'Email configuration', {
        from: mailOptions.from,
        to: mailOptions.to,
        subject: mailOptions.subject,
        has_content: !!mailOptions.text,
        content_length: mailOptions.text.length
      });

      // Verify SMTP connection
      try {
        await transporter.verify();
        log('info', 'SMTP connection verified successfully');
      } catch (error) {
        log('error', 'SMTP connection verification failed', {
          error: error.message,
          code: error.code
        });
        throw error;
      }

      const info = await transporter.sendMail(mailOptions);
      
      log('info', 'Email sent successfully', { 
        to: defaultContact.email,
        call_id,
        message_id: info.messageId,
        response: info.response,
        accepted: info.accepted,
        rejected: info.rejected
      });

      return res.status(200).json({ 
        message: 'Email sent successfully',
        contact: {
          name: defaultContact.name,
          email: defaultContact.email
        },
        call: {
          id: call_id,
          duration: formatDuration(duration_ms),
          status: call_status,
          cost: call_cost ? formatCost(call_cost.combined_cost) : null
        },
        email: {
          message_id: info.messageId,
          accepted: info.accepted,
          rejected: info.rejected
        }
      });
    } catch (error) {
      log('error', 'Failed to send email', { 
        error: error.message,
        error_code: error.code,
        error_command: error.command,
        to: defaultContact.email,
        call_id,
        stack: error.stack
      });

      // Log additional error details if available
      if (error.response) {
        log('error', 'SMTP error response', {
          code: error.responseCode,
          command: error.command,
          response: error.response
        });
      }

      return res.status(500).json({ 
        error: 'Failed to send email',
        message: 'Internal server error while sending email',
        details: error.message,
        code: error.code
      });
    }
  } catch (error) {
    log('error', 'Unexpected error in webhook handler', { 
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({ 
      error: 'Internal server error',
      message: 'An unexpected error occurred while processing the webhook',
      details: error.message
    });
  }
} 