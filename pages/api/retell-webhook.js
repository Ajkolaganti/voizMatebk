import { sendEmail } from '../../utils/gmail';
import contacts from '../../data/contacts.json';
import path from 'path';
import fs from 'fs';

// Helper function to clean phone numbers
function cleanPhoneNumber(phone) {
  return phone.replace(/\D/g, '');
}

// Helper function to find contact by phone number
function findContactByPhone(phone) {
  const cleanedPhone = cleanPhoneNumber(phone);
  return contacts.find(contact => 
    cleanPhoneNumber(contact.number) === cleanedPhone
  );
}

// Helper function to generate voice prompt
function generateVoicePrompt(contact) {
  if (contact) {
    return `Hey, this is Ajay! Oh hey ${contact.name}, Ajay's busy right now, but I'll let him know you called.`;
  }
  return "Hey! This is Ajay. Can I know who's calling and what this is regarding?";
}

// Helper function to format duration
function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      caller_number,
      transcript,
      duration,
      transcript_summary
    } = req.body;

    // Find contact if exists
    const contact = findContactByPhone(caller_number);
    
    // Generate voice prompt
    const voicePrompt = generateVoicePrompt(contact);

    // Prepare email content with modern formatting
    const emailSubject = `📞 New Call ${contact ? `from ${contact.name}` : 'from Unknown Number'}`;
    const emailText = `
🚀 *Incoming Call Alert* 🚀

📱 *Call Details*
----------------
👤 Contact: ${contact ? contact.name : 'Unknown'}
📞 Number: ${caller_number}
⏱️ Duration: ${formatDuration(duration)}

${transcript_summary ? `📝 *Call Summary*\n${transcript_summary}\n` : ''}

📜 *Full Transcript*
------------------
${transcript || 'No transcript available'}

---
🤖 *This is an automated message from your AI Assistant*
    `;

    // Send email
    await sendEmail(emailSubject, emailText);

    // Return success response
    return res.status(200).json({
      success: true,
      voice_prompt: voicePrompt
    });

  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
} 