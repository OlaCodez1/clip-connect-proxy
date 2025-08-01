import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { nanoid } from 'nanoid';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

dotenv.config();

// Validate environment variables
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_KEY in environment');
}

// Supabase client (secure)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Express app
const app = express();
app.use(express.json());

app.use(cors()); // Allow all origins (OK for mobile apps)

// Rate limit: max 100 requests per IP per minute
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100
}));

// Route: Create new session
app.post('/create-session', async (req, res) => {
  let code = '';
  let tries = 0;

  while (tries < 5) {
    code = nanoid(6).toUpperCase();
    const { data, error } = await supabase
      .from('sessions')
      .insert([{ code }])
      .select()
      .single();

    if (!error) return res.json({ sessionId: data.id, code });
    if (error.code !== '23505') return res.status(500).json({ error: 'Failed to create session' });

    tries++;
  }

  res.status(500).json({ error: 'Code generation failed' });
});

// Route: Join session by code
app.post('/join-session', async (req, res) => {
  const { code, deviceId } = req.body;
  if (typeof code !== 'string' || code.length !== 6) {
    return res.status(400).json({ error: 'Invalid code' });
  }

  const { data, error } = await supabase
    .from('sessions')
    .select()
    .eq('code', code)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Session not found' });

  if (deviceId && typeof deviceId === 'string') {
    const current = data.device_ids || [];
    if (!current.includes(deviceId)) {
      await supabase
        .from('sessions')
        .update({ device_ids: [...current, deviceId] })
        .eq('id', data.id);
    }
  }

  res.json({ sessionId: data.id });
});

// Route: Sync clipboard
app.post('/sync', async (req, res) => {
  const { sessionId, clip, fromDevice } = req.body;
  if (typeof sessionId !== 'string' || typeof clip !== 'string') {
    return res.status(400).json({ error: 'Invalid sessionId or clip' });
  }

  const { error } = await supabase.from('clipboard_items').insert([{
    session_id: sessionId,
    content: clip,
    from_device: fromDevice || null
  }]);

  if (error) return res.status(500).json({ error: 'Failed to sync' });
  res.json({ success: true });
});

// Route: Get latest clipboard item
app.get('/latest', async (req, res) => {
  const { sessionId } = req.query;
  if (typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'Missing sessionId' });
  }

  const { data, error } = await supabase
    .from('clipboard_items')
    .select()
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return res.status(404).json({ error: 'No data found' });

  res.json({
    content: data.content,
    fromDevice: data.from_device,
    timestamp: data.created_at
  });
});

// Global error handling (optional)
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Clip Connect API running on port ${PORT}`);
});
