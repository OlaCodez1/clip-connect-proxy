import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { nanoid } from 'nanoid';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

dotenv.config();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_KEY');
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const app = express();
app.use(express.json());
app.use(cors());
app.use(rateLimit({ windowMs: 60_000, max: 100 }));

function generateKey() {
  return crypto.randomBytes(32).toString('base64');
}

async function generateUniqueSessionCode() {
  let code = '';
  let isUnique = false;
  let tries = 0;

  while (!isUnique && tries < 10) {
    code = nanoid(6).toUpperCase();

    const { data, error } = await supabase
      .from('sessions')
      .select('id')
      .eq('code', code)
      .single();

    if (!data && !error) {
      isUnique = true;
    }

    tries++;
  }

  if (!isUnique) throw new Error('Failed to generate unique code');
  return code;
}

app.post('/create-session', async (req, res) => {
  try {
    const code = await generateUniqueSessionCode();
    const key = generateKey();

    const { data, error } = await supabase
      .from('sessions')
      .insert([{ code, aes_key: key }])
      .select()
      .single();

    if (error) throw error;

    res.json({ sessionId: data.id, code, aesKey: key });
  } catch (err) {
    console.error('Session creation failed:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

app.post('/join-session', async (req, res) => {
  const { code } = req.body;
  if (typeof code !== 'string' || code.length !== 6) {
    return res.status(400).json({ error: 'Invalid code' });
  }

  const { data, error } = await supabase
    .from('sessions')
    .select()
    .eq('code', code)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json({ sessionId: data.id, aesKey: data.aes_key });
});

app.post('/sync', async (req, res) => {
  const { sessionId, clip } = req.body;
  if (!sessionId || !clip) {
    return res.status(400).json({ error: 'Missing sessionId or clip' });
  }

  const { error } = await supabase
    .from('clipboard_items')
    .insert([{ session_id: sessionId, content: clip }]);

  if (error) {
    console.error('Sync error:', error);
    return res.status(500).json({ error: 'Failed to sync' });
  }

  res.json({ success: true });
});

app.get('/latest/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  const { data, error } = await supabase
    .from('clipboard_items')
    .select()
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'No clipboard found' });
  }

  res.json({ clip: data.content });
});

app.post('/end-session', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId' });
  }

  await supabase.from('clipboard_items').delete().eq('session_id', sessionId);
  const { error } = await supabase.from('sessions').delete().eq('id', sessionId);

  if (error) {
    console.error('End session error:', error);
    return res.status(500).json({ error: 'Failed to end session' });
  }

  res.json({ success: true });
});

process.on('unhandledRejection', (err) =>
  console.error('Unhandled:', err)
);
process.on('uncaughtException', (err) =>
  console.error('Uncaught:', err)
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
