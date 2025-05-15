import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import { promises as fs } from 'fs';
import path from 'path';

// Add CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, PATCH, DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Max-Age': '86400'
};

// Add Vapi API configuration
const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_API_URL = 'https://api.vapi.ai/api';

// Initialize Gmail API
const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

// Add this after the imports
const DEFAULT_EMAIL = process.env.DEFAULT_EMAIL || 'your-default-email@example.com';

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

// Track call status changes
const trackCallStatus = (call) => {
  const {
    id,
    status,
    startTime,
    endTime,
    duration,
    from,
    to,
    error
  } = call;

  // Log call status change
  log('info', 'Call status change', {
    call_id: id,
    status,
    start_time: startTime ? formatTimestamp(startTime) : 'N/A',
    end_time: endTime ? formatTimestamp(endTime) : 'N/A',
    duration: duration ? formatDuration(duration) : 'N/A',
    from,
    to,
    error: error || 'N/A'
  });

  // Log additional details based on call status
  switch (status) {
    case 'in-progress':
      log('info', 'Call started', {
        call_id: id,
        start_time: formatTimestamp(startTime)
      });
      break;
    
    case 'completed':
      log('info', 'Call ended', {
        call_id: id,
        duration: formatDuration(duration),
        from,
        to
      });
      break;
    
    case 'failed':
      log('error', 'Call failed', {
        call_id: id,
        error
      });
      break;
    
    default:
      log('info', 'Unknown call status', {
        call_id: id,
        status
      });
  }
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

// Add function to fetch call details from Vapi
async function fetchCallDetails(callId) {
  try {
    log('info', 'Fetching call details from Vapi', { callId });
    
    const response = await fetch(`${VAPI_API_URL}/logs`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Vapi API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    log('info', 'Received call details from Vapi', { 
      callId,
      hasData: !!data,
      dataLength: JSON.stringify(data).length
    });

    return data;
  } catch (error) {
    log('error', 'Failed to fetch call details from Vapi', {
      error: error.message,
      callId
    });
    throw error;
  }
}

// Update sendEmail function to use Vapi data
async function sendEmail(call) {
  try {
    // Fetch call details from Vapi
    const callDetails = await fetchCallDetails(call.id);
    
    // Read contacts
    const contactsPath = path.join(process.cwd(), 'data', 'contacts.json');
    log('info', 'Reading contacts from:', { path: contactsPath });
    
    let contacts = [];
    try {
      const contactsData = await fs.readFile(contactsPath, 'utf8');
      contacts = JSON.parse(contactsData);
      log('info', 'Successfully loaded contacts:', { count: contacts.length });
    } catch (error) {
      log('error', 'Error reading contacts:', { error: error.message });
      // Continue with default email if contacts file can't be read
    }

    // Find contact or use default
    const callerNumber = call.from;
    let recipientEmail = DEFAULT_EMAIL;
    
    if (callerNumber && contacts.length > 0) {
      const contact = contacts.find(c => c.number === callerNumber);
      if (contact && contact.email) {
        recipientEmail = contact.email;
        log('info', 'Found contact email:', { name: contact.name, email: contact.email });
      } else {
        log('info', 'No email found for contact, using default:', { number: callerNumber });
      }
    } else {
      log('info', 'Using default email recipient:', { email: DEFAULT_EMAIL });
    }

    // Validate email address
    if (!recipientEmail || !recipientEmail.includes('@')) {
      throw new Error('Invalid recipient email address');
    }

    // Prepare email content with Vapi data
    const emailContent = formatEmailContent({
      ...call,
      ...callDetails
    });
    log('info', 'Prepared email content:', { length: emailContent.length });

    // Create transporter
    const transporter = createTransporter();
    if (!transporter) {
      throw new Error('Failed to create email transporter');
    }

    // Send email
    const info = await transporter.sendMail({
      from: process.env.GMAIL_EMAIL,
      to: recipientEmail,
      subject: `Call Summary - ${call.id}`,
      text: emailContent,
      html: formatEmailContentHtml({
        ...call,
        ...callDetails
      })
    });

    log('info', 'Email sent successfully:', {
      messageId: info.messageId,
      recipient: recipientEmail,
      callId: call.id
    });

    return info;
  } catch (error) {
    log('error', 'Failed to send email:', {
      error: error.message,
      error_code: error.code,
      error_command: error.command,
      call_id: call.id,
      stack: error.stack
    });
    throw error;
  }
}

// Update formatEmailContent to include Vapi data
function formatEmailContent(call) {
  const {
    id,
    status,
    startTime,
    endTime,
    duration,
    from,
    to,
    error,
    transcript,
    recordingUrl,
    summary,
    cost,
    logs,
    metadata
  } = call;

  return `
📞 Call Summary
==============

📋 Call Details
--------------
From: ${process.env.GMAIL_EMAIL}
Caller: ${from || 'Unknown'}
Recipient: ${to || 'Unknown'}
Call ID: ${id}
Status: ${status}
Duration: ${formatDuration(duration)}
Started: ${formatTimestamp(startTime)}
Ended: ${formatTimestamp(endTime)}
${error ? `Error: ${error}` : ''}

${summary ? `
📊 Call Summary
--------------
${summary}
` : ''}

${logs ? `
📝 Call Logs
-----------
${logs.map(log => `[${formatTimestamp(log.timestamp)}] ${log.message}`).join('\n')}
` : ''}

${metadata ? `
📋 Additional Information
-----------------------
${Object.entries(metadata).map(([key, value]) => `${key}: ${value}`).join('\n')}
` : ''}

${cost ? `
💰 Cost
-------
Total Cost: ${formatCost(cost)}
` : ''}

${transcript ? `
📝 Transcript
-----------
${transcript}
` : ''}

${recordingUrl ? `
🔗 Recording
----------
${recordingUrl}
` : ''}

---
This is an automated message from your Vapi AI Assistant.
`;
}

// Update formatEmailContentHtml to include Vapi data
function formatEmailContentHtml(call) {
  const {
    id,
    status,
    startTime,
    endTime,
    duration,
    from,
    to,
    error,
    transcript,
    recordingUrl,
    summary,
    cost,
    logs,
    metadata
  } = call;

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #2c3e50;">📞 Call Summary</h1>
      
      <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
        <h2 style="color: #34495e;">📋 Call Details</h2>
        <p><strong>From:</strong> ${process.env.GMAIL_EMAIL}</p>
        <p><strong>Caller:</strong> ${from || 'Unknown'}</p>
        <p><strong>Recipient:</strong> ${to || 'Unknown'}</p>
        <p><strong>Call ID:</strong> ${id}</p>
        <p><strong>Status:</strong> ${status}</p>
        <p><strong>Duration:</strong> ${formatDuration(duration)}</p>
        <p><strong>Started:</strong> ${formatTimestamp(startTime)}</p>
        <p><strong>Ended:</strong> ${formatTimestamp(endTime)}</p>
        ${error ? `<p><strong>Error:</strong> ${error}</p>` : ''}
      </div>

      ${summary ? `
      <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
        <h2 style="color: #34495e;">📊 Call Summary</h2>
        <p>${summary}</p>
      </div>
      ` : ''}

      ${logs ? `
      <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
        <h2 style="color: #34495e;">📝 Call Logs</h2>
        <pre style="white-space: pre-wrap;">${logs.map(log => `[${formatTimestamp(log.timestamp)}] ${log.message}`).join('\n')}</pre>
      </div>
      ` : ''}

      ${metadata ? `
      <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
        <h2 style="color: #34495e;">📋 Additional Information</h2>
        <ul>
          ${Object.entries(metadata).map(([key, value]) => `<li><strong>${key}:</strong> ${value}</li>`).join('')}
        </ul>
      </div>
      ` : ''}

      ${cost ? `
      <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
        <h2 style="color: #34495e;">💰 Cost</h2>
        <p><strong>Total Cost:</strong> ${formatCost(cost)}</p>
      </div>
      ` : ''}

      ${transcript ? `
      <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
        <h2 style="color: #34495e;">📝 Transcript</h2>
        <pre style="white-space: pre-wrap;">${transcript}</pre>
      </div>
      ` : ''}

      ${recordingUrl ? `
      <div style="background: #f8f9fa; padding: 15px; border-radius: 5px;">
        <h2 style="color: #34495e;">🔗 Recording</h2>
        <p><a href="${recordingUrl}">Listen to Recording</a></p>
      </div>
      ` : ''}

      <hr style="margin: 20px 0;">
      <p style="color: #7f8c8d; font-size: 12px;">This is an automated message from your Vapi AI Assistant.</p>
    </div>
  `;
}

export default async function handler(req, res) {
  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    return res.status(200).end();
  }

  // Add CORS headers to all responses
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  // Handle GET requests with a helpful message
  if (req.method === 'GET') {
    log('info', 'Received GET request', { 
      path: req.url,
      query: req.query,
      headers: req.headers
    });
    
    return res.status(200).json({
      status: 'ok',
      message: 'This is a webhook endpoint for Vapi AI. Please use POST method to send call data.',
      usage: {
        method: 'POST',
        endpoint: '/api/vapi-webhook',
        requiredFields: ['id', 'status'],
        example: {
          id: 'unique-call-id',
          status: 'completed',
          startTime: '2024-03-14T12:00:00Z',
          endTime: '2024-03-14T12:05:00Z',
          duration: 300000,
          from: '+1234567890',
          to: '+0987654321',
          transcript: 'Call transcript here...'
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

    const call = req.body;
    
    // Validate required fields
    if (!call.id || !call.status) {
      log('error', 'Missing required fields', {
        body: req.body
      });
      return res.status(400).json({ 
        error: 'Missing required fields',
        message: 'The request body must include id and status fields',
        example: {
          id: 'unique-call-id',
          status: 'completed',
          startTime: '2024-03-14T12:00:00Z',
          endTime: '2024-03-14T12:05:00Z',
          duration: 300000,
          from: '+1234567890',
          to: '+0987654321'
        }
      });
    }

    // Track call status changes
    trackCallStatus(call);

    // Process completed calls for email sending
    if (call.status !== 'completed') {
      log('info', 'Ignoring non-completed call', { 
        status: call.status 
      });
      return res.status(200).json({ 
        message: 'Call received but not processed',
        status: call.status
      });
    }

    log('info', 'Processing completed call', { 
      id: call.id,
      status: call.status,
      duration: call.duration,
      from: call.from,
      to: call.to,
      has_transcript: !!call.transcript,
      has_recording: !!call.recordingUrl
    });

    // Send email
    try {
      const info = await sendEmail(call);
      
      return res.status(200).json({ 
        message: 'Email sent successfully',
        call: {
          id: call.id,
          duration: formatDuration(call.duration),
          status: call.status,
          from: call.from,
          to: call.to
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
        call_id: call.id,
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