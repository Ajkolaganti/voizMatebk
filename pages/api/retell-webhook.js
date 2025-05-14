import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import { promises as fs } from 'fs';
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
    call_id,
    call_type,
    call_status,
    start_timestamp,
    end_timestamp,
    duration_ms,
    disconnection_reason,
    call_cost
  } = call;

  // Log call status change
  log('info', 'Call status change', {
    call_id,
    call_type,
    call_status,
    start_time: start_timestamp ? formatTimestamp(start_timestamp) : 'N/A',
    end_time: end_timestamp ? formatTimestamp(end_timestamp) : 'N/A',
    duration: duration_ms ? formatDuration(duration_ms) : 'N/A',
    disconnection_reason: disconnection_reason || 'N/A',
    cost: call_cost ? formatCost(call_cost.combined_cost) : 'N/A'
  });

  // Log additional details based on call status
  switch (call_status) {
    case 'ongoing':
      log('info', 'Call started', {
        call_id,
        start_time: formatTimestamp(start_timestamp)
      });
      break;
    
    case 'ended':
      log('info', 'Call ended', {
        call_id,
        duration: formatDuration(duration_ms),
        reason: disconnection_reason,
        cost: call_cost ? formatCost(call_cost.combined_cost) : 'N/A'
      });
      break;
    
    case 'failed':
      log('error', 'Call failed', {
        call_id,
        reason: disconnection_reason
      });
      break;
    
    default:
      log('info', 'Unknown call status', {
        call_id,
        status: call_status
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

// Add this after the helper functions and before sendEmail
function formatEmailContent(call) {
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
    call_cost,
    call_analysis
  } = call;

  return `
📞 Call Summary
==============

📋 Call Details
--------------
From: ${process.env.GMAIL_EMAIL}
Call ID: ${call_id}
Type: ${call_type}
Status: ${call_status}
Duration: ${formatDuration(duration_ms)}
Started: ${formatTimestamp(start_timestamp)}
Ended: ${formatTimestamp(end_timestamp)}
Disconnection Reason: ${disconnection_reason || 'Not specified'}

${call_analysis ? `
📊 Call Analysis
--------------
Summary: ${call_analysis.call_summary}
User Sentiment: ${call_analysis.user_sentiment}
Call Successful: ${call_analysis.call_successful ? 'Yes' : 'No'}
${call_analysis.in_voicemail ? '📱 Left Voicemail' : ''}
` : ''}

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
}

// Update the sendEmail function to use consistent logging
async function sendEmail(call) {
  try {
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
    const callerNumber = call.caller_number;
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

    // Prepare email content
    const emailContent = formatEmailContent(call);
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
      subject: `Call Summary - ${call.call_id}`,
      text: emailContent,
      html: formatEmailContentHtml(call) // Use HTML version for better formatting
    });

    log('info', 'Email sent successfully:', {
      messageId: info.messageId,
      recipient: recipientEmail,
      callId: call.call_id
    });

    return info;
  } catch (error) {
    log('error', 'Failed to send email:', {
      error: error.message,
      error_code: error.code,
      error_command: error.command,
      call_id: call.call_id,
      stack: error.stack
    });
    throw error;
  }
}

// Add HTML email formatting function
function formatEmailContentHtml(call) {
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
    call_cost,
    call_analysis
  } = call;

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #2c3e50;">📞 Call Summary</h1>
      
      <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
        <h2 style="color: #34495e;">📋 Call Details</h2>
        <p><strong>From:</strong> ${process.env.GMAIL_EMAIL}</p>
        <p><strong>Call ID:</strong> ${call_id}</p>
        <p><strong>Type:</strong> ${call_type}</p>
        <p><strong>Status:</strong> ${call_status}</p>
        <p><strong>Duration:</strong> ${formatDuration(duration_ms)}</p>
        <p><strong>Started:</strong> ${formatTimestamp(start_timestamp)}</p>
        <p><strong>Ended:</strong> ${formatTimestamp(end_timestamp)}</p>
        <p><strong>Disconnection Reason:</strong> ${disconnection_reason || 'Not specified'}</p>
      </div>

      ${call_analysis ? `
      <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
        <h2 style="color: #34495e;">📊 Call Analysis</h2>
        <p><strong>Summary:</strong> ${call_analysis.call_summary}</p>
        <p><strong>User Sentiment:</strong> ${call_analysis.user_sentiment}</p>
        <p><strong>Call Successful:</strong> ${call_analysis.call_successful ? 'Yes' : 'No'}</p>
        ${call_analysis.in_voicemail ? '<p><strong>📱 Left Voicemail</strong></p>' : ''}
      </div>
      ` : ''}

      ${call_cost ? `
      <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
        <h2 style="color: #34495e;">💰 Cost Breakdown</h2>
        <p><strong>Total Cost:</strong> ${formatCost(call_cost.combined_cost)}</p>
        <p><strong>Duration Cost:</strong> ${formatCost(call_cost.total_duration_unit_price)}</p>
        <h3>Product Costs:</h3>
        <ul>
          ${call_cost.product_costs.map(cost => `<li>${cost.product}: ${formatCost(cost.cost)}</li>`).join('')}
        </ul>
      </div>
      ` : ''}

      ${transcript ? `
      <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
        <h2 style="color: #34495e;">📝 Transcript</h2>
        <pre style="white-space: pre-wrap;">${transcript}</pre>
      </div>
      ` : ''}

      <div style="background: #f8f9fa; padding: 15px; border-radius: 5px;">
        <h2 style="color: #34495e;">🔗 Links</h2>
        ${recording_url ? `<p><a href="${recording_url}">Recording</a></p>` : ''}
        ${public_log_url ? `<p><a href="${public_log_url}">Call Log</a></p>` : ''}
      </div>

      <hr style="margin: 20px 0;">
      <p style="color: #7f8c8d; font-size: 12px;">This is an automated message from your Retell Voice Agent.</p>
    </div>
  `;
}

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

    // Track call status changes for all events
    trackCallStatus(call);

    // Process both call_ended and call_analyzed events for email sending
    if (event !== 'call_ended' && event !== 'call_analyzed') {
      log('info', 'Ignoring non-call completion event', { 
        event,
        call_status: call.call_status 
      });
      return res.status(200).json({ 
        message: 'Event received but not processed',
        event,
        call_status: call.call_status
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
      call_cost,
      call_analysis
    } = call;

    log('info', 'Processing call completion event', { 
      event,
      call_id,
      call_type,
      call_status,
      duration_ms,
      has_transcript: !!transcript,
      has_recording: !!recording_url,
      has_log: !!public_log_url,
      disconnection_reason,
      call_cost,
      has_analysis: !!call_analysis
    });

    // Send email
    try {
      const info = await sendEmail(call);
      
      return res.status(200).json({ 
        message: 'Email sent successfully',
        contact: {
          name: call.name,
          email: call.email
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