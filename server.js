const express = require('express')
const path = require('path')
require('dotenv').config()

console.log('🚀 Starting Minimal Q&A Composer Server...')
console.log('📁 Working directory:', __dirname)
console.log('🔧 Loading dependencies...')

// Analytics logging functions
let supabaseAnalytics = null
const SESSION_MAX_IDLE_MINUTES = parseInt(process.env.SESSION_MAX_IDLE_MINUTES || '180', 10)

function initAnalytics() {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY // Service role key for analytics
  
  if (supabaseUrl && supabaseServiceKey) {
    const { createClient } = require('@supabase/supabase-js')
    supabaseAnalytics = createClient(supabaseUrl, supabaseServiceKey)
    console.log('📊 Analytics logging initialized')
  } else {
    console.warn('⚠️ Analytics not configured - missing SUPABASE_SERVICE_ROLE_KEY')
  }
}

// Helper to detect device type from user agent
function getDeviceType(userAgent) {
  if (!userAgent) return 'unknown'
  const ua = userAgent.toLowerCase()
  if (/mobile|android|iphone/.test(ua)) return 'mobile'
  if (/tablet|ipad/.test(ua)) return 'tablet'
  return 'desktop'
}

// Attempt to find an existing open session for this user/device
async function findExistingOpenSession(userId, deviceType, suggestedId = null) {
  try {
    // Prefer suggested session id if provided and valid
    if (suggestedId) {
      const { data: suggested, error: sugErr } = await supabaseAnalytics
        .from('user_sessions')
        .select('id, user_id, session_end')
        .eq('id', suggestedId)
        .eq('user_id', userId)
        .is('session_end', null)
        .single()
      if (!sugErr && suggested?.id) return suggested.id
    }

    // Otherwise find the most recent open session for this user (optionally by device)
    const sinceIso = new Date(Date.now() - SESSION_MAX_IDLE_MINUTES * 60 * 1000).toISOString()
    let q = supabaseAnalytics
      .from('user_sessions')
      .select('id, user_id, device_type, session_start, session_end')
      .eq('user_id', userId)
      .is('session_end', null)
      .gte('session_start', sinceIso)
      .order('session_start', { ascending: false })
      .limit(1)
    if (deviceType && deviceType !== 'unknown') q = q.eq('device_type', deviceType)
    const { data: existing, error } = await q
    if (!error && Array.isArray(existing) && existing[0]?.id) {
      return existing[0].id
    }
  } catch (_) {}
  return null
}

// Log user session start (idempotent across refresh/multi-tab/server restarts)
async function logSessionStart(userId, email, req, clientSessionId = null) {
  if (!supabaseAnalytics) return null
  
  try {
    const userAgent = req.headers['user-agent'] || ''
    const deviceType = getDeviceType(userAgent)
    const domain = email ? email.split('@')[1] : null

    // Try to reuse an existing open session (provided id or latest open for this user/device)
    const reuseId = await findExistingOpenSession(userId, deviceType, clientSessionId)
    if (reuseId) {
      console.log(`📊 Reusing existing session for ${email}: ${reuseId}`)
      return reuseId
    }

    // No reusable session → create a new one
    const { data, error } = await supabaseAnalytics
      .from('user_sessions')
      .insert({
        user_id: userId,
        email: email,
        domain: domain,
        device_type: deviceType,
        session_start: new Date().toISOString()
      })
      .select()
      .single()

    if (error) {
      console.error('Analytics session start error:', error)
      return null
    }

    console.log(`📊 Session started: ${email} (${deviceType})`)
    return data?.id
  } catch (e) {
    console.error('Analytics session start exception:', e)
    return null
  }
}

// Log user session end
async function logSessionEnd(sessionId) {
  if (!supabaseAnalytics || !sessionId) return
  
  try {
    const { error } = await supabaseAnalytics
      .from('user_sessions')
      .update({
        session_end: new Date().toISOString()
      })
      .eq('id', sessionId)
    
    if (error) {
      console.error('Analytics session end error:', error)
    } else {
      console.log('📊 Session ended:', sessionId)
    }
  } catch (e) {
    console.error('Analytics session end exception:', e)
  }
}

// Log question creation/update with subject and title tracking
async function logQuestionAction(userId, sessionId, action, questionData) {
  if (!supabaseAnalytics) return
  
  try {
    const { error } = await supabaseAnalytics
      .from('question_analytics')
      .insert({
        user_id: userId,
        session_id: sessionId,
        question_id: questionData.id,
        subject_name: questionData.subjectName || null,
        question_title: questionData.title || questionData.question || null,
        action_type: action, // 'create', 'update', 'delete'
        created_at: new Date().toISOString()
      })
    
    if (error) {
      console.error('Analytics question action error:', error)
    } else {
      console.log(`📊 Question ${action}:`, questionData.id)
    }
  } catch (e) {
    console.error('Analytics question action exception:', e)
  }
}

// Log API call with per-step timing (optionally link to question)
async function logApiCall(userId, sessionId, endpoint, model, startTime, endTime, success, tokenData = null, errorInfo = null, questionId = null, questionCount = null) {
  console.log('🔍 DEBUG: logApiCall called with:', { endpoint, model, userId, sessionId, questionId, success, questionCount })
  
  if (!supabaseAnalytics) {
    console.log('⚠️  DEBUG: supabaseAnalytics not initialized, skipping log')
    return
  }
  
  try {
    const duration = endTime - startTime
    const baseRow = {
        user_id: userId,
        session_id: sessionId,
        endpoint: endpoint,
        model_name: model,
        request_time: new Date(startTime).toISOString(),
        duration_ms: duration,
        tokens_used: tokenData?.total_tokens || null,
        prompt_tokens: tokenData?.prompt_tokens || null,
        completion_tokens: tokenData?.completion_tokens || null,
        success: success,
        error_type: errorInfo?.type || null,
        error_message: errorInfo?.message || null,
        created_at: new Date().toISOString()
      }
    
    // Add question count for compose-qa endpoints
    if (questionCount !== null && typeof questionCount === 'number') {
      baseRow.questions_generated = questionCount
    }
    
    // Try to include question_id when the column exists
    let { error } = await supabaseAnalytics
      .from('api_calls')
      .insert(questionId ? { ...baseRow, question_id: questionId } : baseRow)
    if (error) {
      // Fallback insert without question_id to be backward compatible with existing schema
      const fb = await supabaseAnalytics.from('api_calls').insert(baseRow)
      error = fb.error
    }
    
    if (error) {
      console.error('Analytics API call error:', error)
    } else {
      const tokenInfo = tokenData?.total_tokens ? `, ${tokenData.total_tokens} tokens` : ''
      const questionInfo = questionCount ? `, ${questionCount} questions generated` : ''
      console.log(`📊 AI Step: ${endpoint} (${model}) - ${duration}ms${tokenInfo}${questionInfo}`)
    }
  } catch (e) {
    console.error('Analytics API call exception:', e)
  }
}

const Groq = require('groq-sdk')
const fs = require('fs')
const { MongoClient, ObjectId } = require('mongodb')
const { createClient } = require('@supabase/supabase-js')
let OpenAI
try { 
  OpenAI = require('openai')
  console.log('✅ OpenAI SDK loaded successfully')
} catch (_) { 
  OpenAI = null 
  console.log('❌ OpenAI SDK not available')
}

console.log('🔑 Checking API keys...')
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null
const openai = (process.env.OPENAI_API_KEY && OpenAI) ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

// Supabase admin client (server-side only)
const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || ''
const supabaseAdmin = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null

// Allowed email domains (comma-separated). Empty = allow all
const ALLOWED_EMAIL_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean)

// MongoDB setup (templated)
const DB_NAME = process.env.MONGO_DB_NAME || 'calculation_validator'
const MONGO_DB_USERNAME = process.env.MONGO_DB_USERNAME || ''
const MONGO_DB_PASSWORD = process.env.MONGO_DB_PASSWORD || ''
const MONGO_URI = (process.env.MONGODB_URI && process.env.MONGODB_URI.length > 0)
  ? process.env.MONGODB_URI
  : ((MONGO_DB_USERNAME && MONGO_DB_PASSWORD)
      ? `mongodb+srv://${encodeURIComponent(MONGO_DB_USERNAME)}:${encodeURIComponent(MONGO_DB_PASSWORD)}@cluster0.bwtbeur.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`
      : '')
let __client = null
let __db = null
async function connectDb() {
  if (__db) return __db
  if (!MONGO_URI) throw new Error('MongoDB not configured')
  __client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000 })
  await __client.connect()
  __db = __client.db(DB_NAME)
  try {
    await __db.collection('subjects').createIndex({ name: 1 }, { unique: true })
    await __db.collection('questions').createIndex({ subjectId: 1, title: 1 })
    await __db.collection('questions').createIndex({ subjectId: 1, prompt: 'text' })
  } catch (_) {}
  return __db
}
async function getMongoCollection() {
  const db = await connectDb()
  const col = db.collection('questions')
  return { db, col }
}

if (groq) console.log('✅ Groq API configured')
if (openai) console.log('✅ OpenAI API configured')
if (!groq && !openai) console.log('⚠️  No AI APIs configured - set OPENAI_API_KEY or GROQ_API_KEY')

const app = express()
app.use(express.json({ limit: '1mb' }))
app.use(express.static(path.join(__dirname, 'public'), { index: false }))

console.log('🌐 Express app configured with static files from:', path.join(__dirname, 'public'))

// Initialize analytics logging
initAnalytics()

// Clean up any orphaned sessions on server start
async function cleanupOrphanedSessions() {
  if (!supabaseAnalytics) return
  
  try {
    console.log('🧹 Cleaning up orphaned sessions...')
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    
    // End any sessions that don't have an end time and are older than 1 day
    const { error } = await supabaseAnalytics
      .from('user_sessions')
      .update({ session_end: new Date().toISOString() })
      .is('session_end', null)
      .lt('session_start', oneDayAgo)
    
    if (error) {
      console.error('Session cleanup error:', error)
    } else {
      console.log('✅ Session cleanup completed')
    }
  } catch (e) {
    console.error('Session cleanup exception:', e)
  }
}

// Run cleanup after a short delay to allow server to fully start
setTimeout(cleanupOrphanedSessions, 5000)

// Helper to inject Supabase env into static HTML at serve time
function renderHtmlWithSupabase(file) {
  try {
    const html = fs.readFileSync(path.join(__dirname, 'public', file), 'utf-8')
    return html
      .replace(/__SUPABASE_URL__/g, SUPABASE_URL || '')
      .replace(/__SUPABASE_ANON__/g, SUPABASE_ANON_KEY || '')
      .replace(/__ALLOWED_DOMAINS__/g, (process.env.ALLOWED_EMAIL_DOMAINS || ''))
      .replace(/__OTP_RESEND_SECONDS__/g, String(process.env.OTP_RESEND_SECONDS || 60))
  } catch (e) {
    return null
  }
}

// Session tracking for analytics - use in-memory store to avoid duplicate sessions
const activeSessions = new Map() // userId -> sessionId

// Require auth for API routes (minimal JWT verification using Supabase)
async function requireAuth(req, res, next) {
  try {
    const auth = req.headers['authorization'] || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    if (!supabaseAdmin) return res.status(500).json({ error: 'Supabase not configured' })
    const { data, error } = await supabaseAdmin.auth.getUser(token)
    if (error || !data?.user) return res.status(401).json({ error: 'Invalid token' })
    // Restrict allowed email domains
    try {
      const email = (data.user.email || '').toLowerCase()
      const domain = email.split('@')[1]
      if (ALLOWED_EMAIL_DOMAINS.length > 0 && !ALLOWED_EMAIL_DOMAINS.includes(domain)) {
        return res.status(403).json({ error: 'Forbidden: domain not allowed' })
      }
    } catch (_) {}
    req.user = data.user

    // Prefer client-provided analytics session id header
    const clientHeaderSession = req.headers['x-analytics-session'] || null
    let sessionId = (clientHeaderSession && typeof clientHeaderSession === 'string')
      ? clientHeaderSession
      : (activeSessions.get(req.user.id) || null)
    
    // If no session ID available, create one on-demand for analytics
    if (!sessionId && req.user.id && req.user.email) {
      console.log('📊 No session ID found, creating on-demand session for:', req.user.email)
      try {
        sessionId = await logSessionStart(req.user.id, req.user.email, req)
        if (sessionId) {
          activeSessions.set(req.user.id, sessionId)
          console.log('📊 Created on-demand session:', sessionId)
        }
      } catch (e) {
        console.error('📊 Failed to create on-demand session:', e)
      }
    }
    
    req.sessionId = sessionId
    
    // Debug session ID resolution (only log for non-session endpoints to reduce noise)
    if (!req.path.includes('/api/session/')) {
      console.log('🔍 Session ID debug:', {
        endpoint: req.path,
        userId: req.user.id,
        clientHeader: clientHeaderSession,
        cachedSession: activeSessions.get(req.user.id),
        finalSessionId: req.sessionId
      })
    }
    
    next()
  } catch (e) {
    res.status(401).json({ error: 'Unauthorized' })
  }
}

// Serve login page for unauthenticated users
app.get('/login', (req, res) => {
  const html = renderHtmlWithSupabase('login.html')
  if (!html) return res.status(500).send('Login page not found')
  res.setHeader('Content-Type', 'text/html')
  res.send(html)
})

// Session management endpoints (before auth middleware)
app.post('/api/session/start', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id
    const email = req.user.email
    const clientSessionId = (req.body && req.body.clientSessionId) ? String(req.body.clientSessionId) : null
    
    // Check if user already has an active session
    let sessionId = activeSessions.get(userId)

    if (!sessionId) {
      // Try reuse or create
      sessionId = await logSessionStart(userId, email, req, clientSessionId)
      if (sessionId) {
        activeSessions.set(userId, sessionId)
        console.log(`📊 Session ready for ${email}: ${sessionId}`)
      }
    } else {
      console.log(`📊 Using cached session for ${email}`)
    }
    
    res.json({ ok: true, sessionId })
  } catch (e) {
    console.error('Session start error:', e)
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.post('/api/session/end', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id
    const sessionId = activeSessions.get(userId)
    
    if (sessionId) {
      await logSessionEnd(sessionId)
      activeSessions.delete(userId)
      console.log(`📊 Session ended for ${req.user.email}`)
    }
    
    res.json({ ok: true })
  } catch (e) {
    console.error('Session end error:', e)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Protect all other API endpoints
app.use('/api', requireAuth)

// Serve main app. Auth is enforced on all /api calls. The app will redirect to /login if no session client-side.
app.get('/', (_req, res) => {
  const html = renderHtmlWithSupabase('index.html')
  if (!html) return res.status(500).send('Index page not found')
  res.setHeader('Content-Type', 'text/html')
  res.send(html)
})

// === Subjects API ===
app.get('/api/subjects', async (req, res) => {
  try {
    const db = await connectDb()
    const items = await db.collection('subjects').find({}).sort({ name: 1 }).toArray()
    res.json({ ok: true, items: items.map(doc => ({
      id: String(doc._id),
      name: doc.name,
      displayName: doc.displayName || doc.name,
      description: doc.description || '',
      subjectRules: doc.subjectRules || ''
    })) })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'Unknown error' })
  }
})

// === Questions API (now linked to subjects) ===
app.get('/api/questions', async (req, res) => {
  try {
    const db = await connectDb()
    const { subjectId } = req.query
    const filter = subjectId ? { subjectId: new ObjectId(subjectId) } : {}
    const items = await db.collection('questions').find(filter).sort({ _id: -1 }).toArray()
    res.json({ ok: true, items: items.map(doc => ({
      id: String(doc._id),
      subjectId: String(doc.subjectId),
      title: doc.title || null,
      question: doc.question || '',
      workedSolution: doc.workedSolution || '',
      questionRules: doc.questionRules || '',
      verifiedCode: doc.verifiedCode || null,
      state: doc.state || 'draft',
      savedParameterization: doc.savedParameterization || null
    })) })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'Unknown error' })
  }
})

app.post('/api/questions', async (req, res) => {
  try {
    const db = await connectDb()
    const col = db.collection('questions')
    const p = req.body || {}
    const baseDoc = {
      subjectId: ObjectId.isValid(p.subjectId) ? new ObjectId(p.subjectId) : null,
      title: p.title || null,
      question: p.question || '',
      workedSolution: p.workedSolution || '',
      questionRules: p.questionRules || ''
    }
    if (!baseDoc.subjectId) {
      return res.status(400).json({ ok: false, error: 'subjectId is required' })
    }
    let result
    let action = 'create'
    let questionId = null
    
    if (p.id) {
      action = 'update'
      questionId = p.id
      const _id = ObjectId.isValid(p.id) ? new ObjectId(p.id) : null
      if (_id) {
        // Build update object; only touch verifiedCode if explicitly provided
        const update = { $set: baseDoc }
        if (p.hasOwnProperty('verifiedCode')) {
          update.$set.verifiedCode = p.verifiedCode // null clears saved code intentionally
          update.$set.codeVerifiedAt = p.verifiedCode ? new Date() : null
          update.$set.state = p.verifiedCode ? 'verified' : 'draft'
          if (p.verifiedCode === null) {
            // Also clear any saved parameterization snapshot when code is invalidated
            update.$unset = { ...(update.$unset || {}), savedParameterization: "" }
          }
        }
        result = await col.findOneAndUpdate({ _id }, update, { returnDocument: 'after', upsert: true })
        const item = result?.value || (await col.findOne({ _id }))
        
        // Log question update with subject and title
        let subjectName = null
        try {
          const subject = await db.collection('subjects').findOne({ _id: baseDoc.subjectId })
          subjectName = subject?.name || subject?.displayName
        } catch (e) {
          console.warn('Could not resolve subject name for analytics:', e.message)
        }
        
        await logQuestionAction(req.user.id, req.sessionId, action, {
          id: questionId,
          subjectName: subjectName,
          title: baseDoc.title,
          question: baseDoc.question
        })
        
        return res.json({ ok: true, item: { id: String(item._id), subjectId: String(item.subjectId), ...baseDoc, verifiedCode: item?.verifiedCode || null } })
      }
    }
    // Insert path - allow optional verifiedCode if explicitly provided
    const insertDoc = { ...baseDoc, verifiedCode: p.hasOwnProperty('verifiedCode') ? p.verifiedCode : null, state: 'draft' }
    const ins = await col.insertOne(insertDoc)
    questionId = String(ins.insertedId)
    
    // Log question creation with subject and title
    let subjectName = null
    try {
      const subject = await db.collection('subjects').findOne({ _id: baseDoc.subjectId })
      subjectName = subject?.name || subject?.displayName
    } catch (e) {
      console.warn('Could not resolve subject name for analytics:', e.message)
    }
    
    await logQuestionAction(req.user.id, req.sessionId, action, {
      id: questionId,
      subjectName: subjectName,
      title: baseDoc.title,
      question: baseDoc.question
    })
    
    res.json({ ok: true, item: { id: questionId, subjectId: String(baseDoc.subjectId), ...insertDoc } })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'Unknown error' })
  }
})

app.delete('/api/questions/:id', async (req, res) => {
  try {
    const { id } = req.params
    const db = await connectDb()
    const col = db.collection('questions')
    const _id = ObjectId.isValid(id) ? new ObjectId(id) : null
    if (!_id) return res.status(400).json({ ok: false, error: 'Invalid id' })
    await col.deleteOne({ _id })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'Unknown error' })
  }
})

// === Save Verified Code API ===
app.post('/api/questions/:id/code', async (req, res) => {
  try {
    const { id } = req.params
    const { code, parameterization } = req.body || {}
    console.log('\n💾 === SAVE VERIFIED CODE ===')
    console.log('📌 questionId:', id)
    console.log('🧩 code length:', (code || '').length)
    console.log('🧪 parameterization inputs:', Object.keys(parameterization?.inputs || {}))
    const db = await connectDb()
    const col = db.collection('questions')
    const _id = ObjectId.isValid(id) ? new ObjectId(id) : null
    if (!_id) return res.status(400).json({ ok: false, error: 'Invalid id' })
    const set = { verifiedCode: code || null, codeVerifiedAt: code ? new Date() : null }
    if (parameterization && typeof parameterization === 'object') {
      // Persist full parameterization state when available
      set.savedParameterization = {
        inputs: parameterization.inputs || {},
        eval: parameterization.eval || '',
        reasons: parameterization.reasons || '',
        calculation: parameterization.calculation || ''
      }
    }
    if (code) set.state = 'verified'
    const r = await col.updateOne({ _id }, { $set: set })
    console.log('✅ Save result:', r?.modifiedCount === 1 ? 'updated' : 'no-change')
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'Unknown error' })
  }
})

// AI completion with model selection
async function aiComplete({ messages, model, max_tokens = 4000, response_format = null, temperature = undefined, reasoning_effort = undefined, verbosity = undefined, stream = false, userId = null, sessionId = null, endpoint = null, questionId = null, skipAnalytics = false }) {
  const startTime = Date.now()
  console.log('🤖 AI Request:', { 
    model: model || 'default', 
    max_tokens, 
    response_format: response_format ? 'JSON' : 'text',
    messageCount: messages.length 
  })
  
  // Route explicitly requested Groq calls before falling back to OpenAI
  const wantsGroq = typeof model === 'string' && model.toLowerCase() === 'groq'
  if (wantsGroq) {
    if (!groq) {
      throw new Error('Groq API not configured. Set GROQ_API_KEY')
    }
    console.log('🔄 Using Groq API (explicit selection)...')
    try {
      const groqModel = process.env.GROQ_MODEL || 'openai/gpt-oss-120b'
      const resp = await groq.chat.completions.create({ 
        model: groqModel, 
        max_completion_tokens: max_tokens,
        temperature: (typeof temperature === 'number') ? temperature : 1,
        top_p: 1,
        reasoning_effort: 'medium',
        stream: stream,
        messages 
      })
      
      if (stream) {
        let content = ''
        for await (const chunk of resp) {
          const delta = chunk.choices?.[0]?.delta?.content || ''
          content += delta
        }
        content = content.trim()
        console.log('✅ Groq streaming response received:', content.length, 'characters')
        
        if (skipAnalytics) {
          return {
            content: content,
            usage: {
              total_tokens: resp.usage?.total_tokens,
              prompt_tokens: resp.usage?.prompt_tokens,
              completion_tokens: resp.usage?.completion_tokens
            },
            startTime: startTime
          }
        }
        return content
      } else {
        const content = (resp.choices?.[0]?.message?.content || '').trim()
        console.log('✅ Groq response received:', content.length, 'characters')
        
        if (skipAnalytics) {
          return {
            content: content,
            usage: {
              total_tokens: resp.usage?.total_tokens,
              prompt_tokens: resp.usage?.prompt_tokens,
              completion_tokens: resp.usage?.completion_tokens
            },
            startTime: startTime
          }
        }
        return content
      }
    } catch (error) {
      console.error('❌ Groq API error:', error.message)
      throw error
    }
  }
  
  if (openai) {
    console.log('🔄 Using OpenAI API...')
    const isOModel = typeof model === 'string' && model.toLowerCase().startsWith('o')
    const isGpt5 = typeof model === 'string' && model.toLowerCase().startsWith('gpt-5')
    const params = { model: model || 'gpt-4.1' }
    // Attach appropriate token parameter depending on model family
    params.messages = messages
    if (isOModel) {
      params.max_completion_tokens = max_tokens
      // Optional hint for o* models per docs
      params.reasoning_effort = reasoning_effort || 'medium'
    } else {
      params.max_tokens = max_tokens
      // Use provided temperature if specified; otherwise default to 0
      params.temperature = (typeof temperature === 'number') ? temperature : 0
      if (isGpt5 && verbosity) {
        params.verbosity = verbosity
      }
    }
    
    if (response_format) {
      params.response_format = response_format
      console.log('📋 JSON structured output requested')
    }
    
    try {
      const resp = await openai.chat.completions.create(params)
      const choice = resp.choices?.[0]
      let content = ''
      // Structured parse (when using json_schema)
      if (choice?.message?.parsed) {
        try { content = JSON.stringify(choice.message.parsed) } catch (_) {}
      }
      // Standard string
      if (!content && typeof choice?.message?.content === 'string') {
        content = choice.message.content
      }
      // output_text (some SDKs)
      if (!content && typeof resp.output_text === 'string') {
        content = resp.output_text
      }
      // Array-like content blocks, including { type: 'text', text: '...' } or { type: 'output_text', text: { value: '...' } }
      if (!content && Array.isArray(choice?.message?.content)) {
        content = choice.message.content.map(c => {
          if (typeof c === 'string') return c
          if (typeof c?.text === 'string') return c.text
          if (typeof c?.text?.value === 'string') return c.text.value
          return ''
        }).join('')
      }
      content = (content || '').trim()
      console.log('✅ OpenAI response received:', content.length, 'characters')
      
      // Log successful OpenAI API call or return usage data
      const endTime = Date.now()
      if (!skipAnalytics) {
        await logApiCall(userId, sessionId, endpoint, model, startTime, endTime, true, {
          total_tokens: resp.usage?.total_tokens,
          prompt_tokens: resp.usage?.prompt_tokens,
          completion_tokens: resp.usage?.completion_tokens
        }, null, questionId)
        return content
      } else {
        return {
          content: content,
          usage: {
            total_tokens: resp.usage?.total_tokens,
            prompt_tokens: resp.usage?.prompt_tokens,
            completion_tokens: resp.usage?.completion_tokens
          },
          startTime: startTime
        }
      }
    } catch (error) {
      console.error('❌ OpenAI API error:', error.message)
      
      // Log failed OpenAI API call
      const endTime = Date.now()
      if (!skipAnalytics) {
        await logApiCall(userId, sessionId, endpoint, model, startTime, endTime, false, null, {
          type: 'openai_error',
          message: error.message
        }, questionId)
      }
      
      throw error
    }
  }
  
  if (groq) {
    console.log('🔄 Using Groq API...')
    try {
      const resp = await groq.chat.completions.create({ 
        model: 'openai/gpt-oss-120b', 
        max_completion_tokens: max_tokens,
        temperature: (typeof temperature === 'number') ? temperature : 1,
        top_p: 1,
        reasoning_effort: 'medium',
        stream: stream,
        messages 
      })
      
      if (stream) {
        let content = ''
        for await (const chunk of resp) {
          const delta = chunk.choices?.[0]?.delta?.content || ''
          content += delta
        }
        console.log('✅ Groq streaming response received:', content.length, 'characters')
        // Log successful Groq API call or return usage data
        const endTime = Date.now()
        if (!skipAnalytics) {
          try {
            await logApiCall(userId, sessionId, endpoint, model, startTime, endTime, true, {
              total_tokens: resp.usage?.total_tokens,
              prompt_tokens: resp.usage?.prompt_tokens,
              completion_tokens: resp.usage?.completion_tokens
            }, null, questionId)
          } catch (logError) {
            console.error('❌ Analytics logging failed:', logError)
          }
          return content.trim()
        } else {
          return {
            content: content.trim(),
            usage: {
              total_tokens: resp.usage?.total_tokens,
              prompt_tokens: resp.usage?.prompt_tokens,
              completion_tokens: resp.usage?.completion_tokens
            },
            startTime: startTime
          }
        }
      } else {
      const content = (resp.choices?.[0]?.message?.content || '').trim()
      console.log('✅ Groq response received:', content.length, 'characters')
      
      // Log successful Groq API call or return usage data
      const endTime = Date.now()
      if (!skipAnalytics) {
        await logApiCall(userId, sessionId, endpoint, model, startTime, endTime, true, {
          total_tokens: resp.usage?.total_tokens,
          prompt_tokens: resp.usage?.prompt_tokens,
          completion_tokens: resp.usage?.completion_tokens
        }, null, questionId)
        return content
      } else {
        return {
          content: content,
          usage: {
            total_tokens: resp.usage?.total_tokens,
            prompt_tokens: resp.usage?.prompt_tokens,
            completion_tokens: resp.usage?.completion_tokens
          },
          startTime: startTime
        }
      }
      }
    } catch (error) {
      console.error('❌ Groq API error:', error.message)
      
      // Log failed Groq API call
      const endTime = Date.now()
      if (!skipAnalytics) {
        await logApiCall(userId, sessionId, endpoint, model, startTime, endTime, false, null, {
          type: 'groq_error',
          message: error.message
        }, questionId)
      }
      
      throw error
    }
  }
  
  const endTime = Date.now()
  await logApiCall(userId, sessionId, endpoint, 'none', startTime, endTime, false, null, {
    type: 'configuration_error',
    message: 'No LLM configured'
  }, questionId)
  
  console.error('❌ No LLM configured')
  throw new Error('No LLM configured. Set OPENAI_API_KEY or GROQ_API_KEY')
}

// Helper function to execute JavaScript code safely
function executeCode(code) {
  console.log('⚡ Executing generated code...')
  console.log('📝 Code to execute:', code.substring(0, 200) + (code.length > 200 ? '...' : ''))
  
  const logs = []
  const mockConsole = {
    log: (...args) => {
      const message = args.join(' ')
      logs.push(message)
      console.log('📊 Code output:', message)
    }
  }
  
  // Helper functions available to generated code
  const roundToSF = (value, sf) => {
    if (!Number.isFinite(value) || value === 0) return 0
    const sign = value < 0 ? -1 : 1
    const abs = Math.abs(value)
    const magnitude = Math.floor(Math.log10(abs))
    const factor = Math.pow(10, sf - magnitude - 1)
    const rounded = Math.round(abs * factor) / factor
    return Number((sign * rounded).toPrecision(sf))
  }
  
  const round3 = (v) => roundToSF(v, 3)
  const round5 = (v) => roundToSF(v, 5)
  
  try {
    // Clean the code - remove any markdown code blocks
    let cleanCode = code.replace(/```javascript\n?/g, '').replace(/```\n?/g, '').trim()
    console.log('🧹 Cleaned code:', cleanCode.substring(0, 100) + '...')
    
    // Execute code in controlled environment
    const func = new Function('console', 'Math', 'roundToSF', 'round3', 'round5', cleanCode)
    func(mockConsole, Math, roundToSF, round3, round5)
    console.log('✅ Code execution successful, captured', logs.length, 'log entries')
    return { success: true, logs: logs.join('\n'), error: null }
  } catch (error) {
    console.error('❌ Code execution failed:', error.message)
    console.error('🔍 Problematic code snippet:', code.substring(0, 200))
    return { success: false, logs: logs.join('\n'), error: error.message }
  }
}

// Step 1 & 2: Build code and verify with GPT-4.1
app.post('/api/build-and-verify', async (req, res) => {
  console.log('\n🏗️  === BUILD & VERIFY REQUEST ===')
  console.log('📨 Request body keys:', Object.keys(req.body))
  console.log('❓ Question length:', req.body.question?.length || 0)
  console.log('📋 Solution length:', req.body.workedSolution?.length || 0)
  console.log('📏 Subject rules length:', req.body.subjectRules?.length || 0)
  console.log('📏 Question rules length:', req.body.questionRules?.length || 0)
  
  try {
    const { question, workedSolution, subjectRules, questionRules } = req.body
    
    // Strict validation - stop everything if missing required fields
    if (!question || question.trim().length === 0) {
      console.log('❌ Missing or empty question field')
      return res.status(400).json({ error: 'Question field is required and cannot be empty' })
    }
    if (!workedSolution || workedSolution.trim().length === 0) {
      console.log('❌ Missing or empty worked solution field')
      return res.status(400).json({ error: 'Worked solution field is required and cannot be empty' })
    }
    if (!subjectRules || subjectRules.trim().length === 0) {
      console.log('❌ Missing or empty subject rules field')
      return res.status(400).json({ error: 'Subject rules field is required and cannot be empty' })
    }
    if (!questionRules || questionRules.trim().length === 0) {
      console.log('❌ Missing or empty question rules field')
      return res.status(400).json({ error: 'Question rules field is required and cannot be empty' })
    }

    // Step 1: Generate code
    console.log('🔨 Step 1: Generating JavaScript code...')
    const codePrompt = `Convert this worked solution into executable JavaScript code that performs the same calculations.

QUESTION: ${question}

WORKED SOLUTION: ${workedSolution}

SUBJECT RULES: ${subjectRules}

QUESTION RULES: ${questionRules}

REQUIREMENTS (STRICT ADHERENCE TO RULES):
1. Use console.log() for every calculation step
2. Call round5() for intermediate calculations 
3. Call round3() for the final answer
4. The helper functions roundToSF(), round3(), round5() are already available
5. Use appropriate Math functions as needed (Math.pow, Math.sin, Math.cos, Math.sqrt, Math.log, etc.)
6. Convert units as needed based on the problem context
7. Make the code clean and well-commented
8. Every intermediate console.log MUST display a value produced by round5() (five significant figures)
9. The final result MUST be produced by round3() (three significant figures) and printed exactly as: console.log("Final answer: " + finalResult + " [units]")
   - [units] MUST match the units/format implied by the worked solution or the subject rules (do not assume percentages)
10. STRICTLY follow the SUBJECT RULES for calculations, constants, units, precision, and formatting
11. STRICTLY follow the QUESTION RULES for what is allowed and expected in the question context
12. Handle all mathematical operations appropriately (scientific notation, trigonometry, logarithms, etc.)
13. If there is any ambiguity, prefer behavior that keeps results consistent with SUBJECT RULES and WORKED SOLUTION

STRICT OUTPUT:
- Return STRICT JSON with this exact shape (no backticks/markdown):
  { "code": string }
- The code must:
  - Use the existing helper functions round5() and round3(); do not redefine them
  - console.log every intermediate step (5 s.f.) and end with console.log("Final answer: " + finalResult + " %") (3 s.f.)
  - Use variable names consistent with the provided solution/code context
  - Avoid template literals in console.log (use string concatenation)

Generate the JSON now:`

    // Request code in JSON schema format (strict JSON mode)
    const codeSchema = {
      type: "json_schema",
      json_schema: {
        name: "code_generation_response",
        schema: {
          type: "object",
          properties: {
            code: { type: "string" }
          },
          required: ["code"],
          additionalProperties: false
        }
      }
    }

    const codeResponse = await aiComplete({
      messages: [{ role: 'user', content: codePrompt }],
      model: 'gpt-4.1',
      max_tokens: 4000,
      response_format: codeSchema,
      userId: req.user.id,
      sessionId: req.sessionId,
      endpoint: '/api/build-and-verify',
      questionId: req.body?.questionId || null
    })
    let generatedCode = ''
    try {
      const parsed = JSON.parse(codeResponse)
      generatedCode = parsed.code || ''
    } catch (e) {
      console.error('❌ Failed to parse code JSON:', e.message)
      console.error('🔍 Raw codeResponse snippet:', (codeResponse || '').substring(0, 200))
      // Fallback: if the model accidentally returned raw code, use it directly
      generatedCode = codeResponse || ''
    }
    if (!generatedCode || typeof generatedCode !== 'string') {
      return res.status(500).json({ error: 'Empty code generated from JSON response' })
    }

    // Step 2: Execute the code
    console.log('⚡ Step 2: Executing generated code...')
    const execution = executeCode(generatedCode)
    
    if (!execution.success) {
      console.log('❌ Code execution failed:', execution.error)
      return res.json({
        verdict: 'fail',
        reason: `Code execution failed: ${execution.error}`,
        code: generatedCode,
        logs: execution.logs
      })
    }

    // Step 3: Verify with GPT-4.1
    console.log('🔍 Step 3: Verifying with AI...')
    const verifyPrompt = `Verify if this code execution matches the expected worked solution.

ORIGINAL WORKED SOLUTION:
${workedSolution}

GENERATED CODE:
${generatedCode}

CODE OUTPUT:
${execution.logs}

SUBJECT RULES: ${subjectRules}

Compare the code output with the worked solution and determine if the calculation is correct and follows the subject rules.

Respond STRICTLY in JSON with this shape (no markdown/backticks):
{ "verdict": "pass" | "fail", "reason": "one sentence reason" }`

    // Request structured verdict in JSON schema format
    const verifySchema = {
      type: "json_schema",
      json_schema: {
        name: "verification_response",
        schema: {
          type: "object",
          properties: {
            verdict: { type: "string", enum: ["pass", "fail"] },
            reason: { type: "string" }
          },
          required: ["verdict", "reason"],
          additionalProperties: false
        }
      }
    }

    const verificationResponse = await aiComplete({
      messages: [{ role: 'user', content: verifyPrompt }],
      model: 'gpt-4.1',
      max_tokens: 4000,
      response_format: verifySchema
    })
    let verdict = 'fail'
    let reason = 'Unable to parse verification JSON'
    try {
      const parsed = JSON.parse(verificationResponse)
      verdict = parsed.verdict || verdict
      reason = parsed.reason || reason
    } catch (e) {
      console.error('❌ Failed to parse verification JSON:', e.message)
      console.error('🔍 Raw verificationResponse snippet:', (verificationResponse || '').substring(0, 200))
      // Fallback heuristic
      const v = (verificationResponse || '').toLowerCase()
      if (v.includes('pass')) verdict = 'pass'
      reason = verificationResponse || reason
    }
    console.log('📊 Verification result:', verdict)
    console.log('💭 AI reasoning:', (reason || '').substring(0, 200) + '...')
    
    const response = { verdict, reason, code: generatedCode, logs: execution.logs }
    
    console.log('✅ Build & verify completed successfully')
    res.json(response)

  } catch (error) {
    console.error('❌ Build & verify error:', error.message)
    res.status(500).json({ error: error.message })
  }
})

// Step 4: Generate RNG parameters (only if verification passed)
app.post('/api/parameterize', async (req, res) => {
  console.log('\n🎲 === PARAMETERIZE REQUEST ===')
  console.log('📨 Code length:', req.body.code?.length || 0)
  console.log('📏 Subject rules length:', req.body.subjectRules?.length || 0)
  console.log('📏 Question rules length:', req.body.questionRules?.length || 0)
  
  try {
    const { code, question, workedSolution, subjectRules, questionRules } = req.body
    
    // Strict validation - stop everything if missing required fields
    if (!code || code.trim().length === 0) {
      console.log('❌ Missing or empty code parameter')
      return res.status(400).json({ error: 'Generated code is required - please run Build & Verify first' })
    }
    if (!question || question.trim().length === 0) {
      console.log('❌ Missing or empty question field')
      return res.status(400).json({ error: 'Question field is required and cannot be empty' })
    }
    if (!workedSolution || workedSolution.trim().length === 0) {
      console.log('❌ Missing or empty worked solution field')
      return res.status(400).json({ error: 'Worked solution field is required and cannot be empty' })
    }
    if (!subjectRules || subjectRules.trim().length === 0) {
      console.log('❌ Missing or empty subject rules field')
      return res.status(400).json({ error: 'Subject rules field is required and cannot be empty' })
    }
    if (!questionRules || questionRules.trim().length === 0) {
      console.log('❌ Missing or empty question rules field')
      return res.status(400).json({ error: 'Question rules field is required and cannot be empty' })
    }

    console.log('🔄 Generating RNG parameters...')

    const paramPrompt = `Analyze ORIGINAL CODE and return STRICT JSON:
{
  "inputs": { "<name>": "<JS expression to randomize>" },
  "eval": "function evalParams(/* same param names as inputs */){ ... }",
  "calculation": "<JS snippet that reuses ORIGINAL CODE but references these params by name (no redeclarations)>",
  "reasons": "<Plain-language bullet list explaining every eval check derived from RULES>"
}

CONSTRAINTS
- Read QUESTION CONTEXT, SUBJECT RULES, QUESTION RULES.
- Detect numeric variable assignments in ORIGINAL CODE (var/let/const = number/expression). Those become randomized "inputs".
- Keep constants from SUBJECT RULES fixed (do not randomize).
- Use EXACT variable names found in code; do not invent or rename. Do not redeclare them in eval/calculation.
- No arbitrary clamps. Derive all checks from RULES only.

RNG (use Math.random only)
- Choose realistic ranges implied by RULES and the magnitudes in ORIGINAL CODE.
- You MUST use Math.random exclusively (no helper functions like randomFloat, rn, rand, rnd, randomNumber, randomBuretteVolume, etc.).
- For a real-valued parameter in [a,b]: use (a + Math.random()*(b - a)).
- For an integer in [a,b]: use Math.floor(a + Math.random()*(b - a + 1)).
- Use Number( ... .toFixed(k)) only to match required precision.
- Respect instrument constraints from SUBJECT RULES when choosing ranges (e.g., burette reading ≤ 50.00 cm³ and recorded to 2 d.p., divisions 0.05 cm³).

EVAL (rules-derived only, no hardcoded clamps)
- If QUESTION RULES specify a final acceptance band, validate the computed final value strictly against that band and return true/false accordingly.
- Otherwise, DO NOT add ad‑hoc parameter checks; simply compute the final result and return true if it is finite (Number.isFinite), false otherwise.
- Do not introduce any additional thresholds or ranges beyond what is explicitly stated in QUESTION RULES.
- Eval must compute any necessary derived values internally; it must not depend on console logs.

REASONS (plain-language)
- Provide a comprehensive but concise explanation that mirrors eval’s logic step-by-step, in bullet points.
- Each bullet MUST explicitly reference the rule/limit applied (units, sig figs, fixed constants, instrument limits with maximum values like "burette ≤ 50.00 cm³" and 2 d.p. recording), and any acceptance band from QUESTION RULES.
- No code in this field; refer to variables by name.
- Format as a list of lines starting with "- ".

CALCULATION (reuse original, parameterized)
- Provide the ORIGINAL CODE adapted to reference the input parameters by name, with no redeclaration of those parameter variables (they will be defined by the caller).
- Keep constants mandated by SUBJECT RULES as constants inside the code (e.g., volumetric flask 250 cm³, pipette 25.0 cm³, molar mass 100.1 g mol⁻¹).
- Preserve logging and rounding requirements (round5 for intermediates, round3 for final) and the exact final print format: console.log("Final answer: " + finalResult + " [units]") where [units] come from RULES.

EXAMPLES (illustrative; adapt to RULES and ORIGINAL CODE; match exact variable names; do not copy numbers blindly)

Example inputs:
"inputs": {
  "vol_NaOH_cm3": "Number((15 + Math.random()*20).toFixed(2))"
}

Example eval with acceptance band and instrument checks (use exact param names from ORIGINAL CODE):
"eval": "function evalParams(mass_mixture, volume_HCl_cm3, conc_HCl, conc_NaOH, vol_NaOH_cm3){\n  if(!Number.isFinite(mass_mixture)||!Number.isFinite(volume_HCl_cm3)||!Number.isFinite(conc_HCl)||!Number.isFinite(conc_NaOH)||!Number.isFinite(vol_NaOH_cm3)) return false;\n  if(mass_mixture<=0||volume_HCl_cm3<=0||conc_HCl<=0||conc_NaOH<=0||vol_NaOH_cm3<=0) return false;\n  // Instrument constraints from SUBJECT RULES\n  if(vol_NaOH_cm3>50) return false;\n  // Burette reads to 2 d.p. in 0.05 cm^3 divisions → vol*20 must be integer\n  if(Math.abs(vol_NaOH_cm3*20 - Math.round(vol_NaOH_cm3*20))>1e-6) return false;\n  // Compute final value consistent with ORIGINAL CODE (no reliance on console logs)\n  var final_vol_flask_cm3 = 250;\n  var pipette_vol_cm3 = 25.0;\n  var Mr_CaCO3 = 100.1;\n  var vol_NaOH_dm3 = vol_NaOH_cm3/1000;\n  var mol_NaOH = vol_NaOH_dm3*conc_NaOH;\n  var mol_HCl_with_NaOH = mol_NaOH;\n  var scale_factor = final_vol_flask_cm3/pipette_vol_cm3;\n  var mol_HCl_remaining = scale_factor*mol_HCl_with_NaOH;\n  var vol_HCl_dm3 = volume_HCl_cm3/1000;\n  var mol_HCl_initial = vol_HCl_dm3*conc_HCl;\n  var mol_HCl_with_CaCO3 = mol_HCl_initial - mol_HCl_remaining;\n  if(mol_HCl_with_CaCO3<0) return false;\n  var mol_CaCO3 = mol_HCl_with_CaCO3/2;\n  var mass_CaCO3 = mol_CaCO3*Mr_CaCO3;\n  if(mass_CaCO3<0 || mass_CaCO3>mass_mixture) return false;\n  var percent_CaCO3 = (mass_CaCO3/mass_mixture)*100;\n  var finalResult = round3(percent_CaCO3);\n  if(!Number.isFinite(finalResult)) return false;\n  // Acceptance band from QUESTION RULES (edit to match rules if different)\n  if(finalResult<20 || finalResult>75) return false;\n  return true;\n}"

Example reasons (bullet list; no code):
"reasons": "- Inputs must be finite and positive (physical plausibility).\n- Burette reading vol_NaOH_cm3 ≤ 50.00 cm^3 and recorded to 2 d.p.; increments of 0.05 cm^3 per SUBJECT RULES.\n- Fixed constants from SUBJECT RULES: volumetric flask 250 cm^3, pipette 25.0 cm^3, Mr(CaCO3)=100.1 g mol^-1.\n- Final percentage must lie within 20%–75% per QUESTION RULES.\n- Intermediate steps conceptually follow 5 s.f.; final value uses 3 s.f. via round3.\n- Mass of CaCO3 cannot exceed sample mass; negative amounts disallowed."

OUTPUT
- Return ONLY valid JSON (no markdown, no comments, no extra keys).
- Must be parseable by JSON.parse() without preprocessing.

ORIGINAL CODE:
${code}

QUESTION CONTEXT:
${question}

SUBJECT RULES:
${subjectRules}

QUESTION RULES:
${questionRules}`

    const jsonSchema = {
      type: "json_schema",
      json_schema: {
        name: "parameterization_response", 
        schema: {
          type: "object",
          properties: {
            inputs: {
              type: "object",
              additionalProperties: { type: "string" }
            },
            eval: { type: "string" },
            calculation: { type: "string" },
            reasons: { type: "string" }
          },
          required: ["inputs", "eval", "calculation", "reasons"],
          additionalProperties: false
        }
      }
    }

    const paramResponse = await aiComplete({
      messages: [{ role: 'user', content: paramPrompt }],
      model: process.env.PARAM_MODEL || 'gpt-4.1',
      max_tokens: 4000,
      response_format: jsonSchema,
      userId: req.user.id,
      sessionId: req.sessionId,
      endpoint: '/api/parameterize',
      questionId: req.body?.questionId || null
    })

    // Parse the JSON response
    let parsedResponse

    console.log('🔍 Raw parameterization response:', paramResponse)

    try {

      // First try direct parsing
      parsedResponse = JSON.parse(paramResponse)
      console.log('✅ Successfully parsed parameterization JSON')
      console.log('📊 Generated inputs:', Object.keys(parsedResponse.inputs || {}))
      console.log('🔍 Full parameterization:', JSON.stringify(parsedResponse, null, 2))
    } catch (parseError) {
      console.error('❌ Failed to parse JSON response:', parseError.message)
      console.error('🔍 Raw response that failed to parse:', paramResponse.substring(0, 500) + '...')
      
      // Try to clean up the JSON by removing comment-like patterns
      try {
        let cleanedResponse = paramResponse
          // Remove comment-like key-value pairs (e.g., "// comment": "")
          .replace(/,\s*"\/\/[^"]*":\s*"[^"]*"/g, '')
          // Remove trailing commas before closing braces/brackets
          .replace(/,(\s*[}\]])/g, '$1')
        
        console.log('🧹 Attempting to parse cleaned JSON...')
        parsedResponse = JSON.parse(cleanedResponse)
        console.log('✅ Successfully parsed cleaned JSON')
        console.log('📊 Generated inputs:', Object.keys(parsedResponse.inputs || {}))
      } catch (cleanupError) {
        console.error('❌ JSON cleanup also failed:', cleanupError.message)
        // Fallback to simple structure
        parsedResponse = {
          inputs: {},
          eval: "function evalParams() { return true; }",
          reasons: "No reasons provided."
        }
      }
    }

    res.json({
      ok: true,
      parameterization: parsedResponse,
      rawResponse: paramResponse
    })

  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Step 4b: Planning fallback when generation underfills
app.post('/api/plan-params', async (req, res) => {
  console.log('\n🧭 === PLANNING REQUEST ===')
  try {
    const { code, subjectRules, questionRules, question, workedSolution, current, previousAttempts, lastError } = req.body || {}
    console.log('📨 Planning request - current inputs:', Object.keys(current?.inputs || {}))
    console.log('📨 Previous attempts:', previousAttempts?.length || 0)
    console.log('📨 Last error:', lastError || 'None')
    console.log('📨 Question provided:', !!question)
    console.log('📨 Worked solution provided:', !!workedSolution)
    
    if (!current || !current.inputs || !current.eval) {
      console.log('❌ Missing required fields for planning')
      return res.status(400).json({ error: 'current.inputs and current.eval required' })
    }

    const planPrompt = `You are improving RNG parameter expressions for a numerical question generator.

CURRENT CONTEXT:
- ORIGINAL QUESTION:\n${question || 'Not provided'}
- WORKED SOLUTION:\n${workedSolution || 'Not provided'}
- ORIGINAL CODE (calculation to reuse):\n${code}
- SUBJECT RULES:\n${subjectRules}
- QUESTION RULES:\n${questionRules}

CURRENT PARAMETERIZATION:
- inputs (Math.random expressions):\n${JSON.stringify(current.inputs, null, 2)}
- eval function:\n${current.eval}
- reasons (what eval checks):\n${current.reasons || ''}

PARAMETER EXECUTION CONTEXT:
The above inputs generate JavaScript code like this for each run:
${Object.entries(current.inputs).map(([name, expr]) => 
  `const ${name} = ${expr} // This creates: const ${name} = [generated value]`
).join('\n')}

Then this code is executed together with the original calculation code:
${code}

CONFLICT ANALYSIS:
If the error mentions "already been declared", it means:
1. The parameter inputs above are creating duplicate variable names
2. OR the original code already declares variables that the parameters are trying to redeclare
3. OR multiple parameter expressions reference the same variable name

The solution must ensure unique variable names and avoid conflicts between:
- Parameter declarations (const ${Object.keys(current.inputs).join(', const ')})
- Original code variable declarations
- Eval function variable references

${lastError ? `
LAST ERROR ENCOUNTERED:
${lastError}

ERROR EXECUTION CONTEXT:
When the error occurred, the system was trying to execute code that looked like this:

// Parameter declarations (from current.inputs):
${Object.entries(current.inputs).map(([name, expr]) => `const ${name} = ${expr.replace('Math.random()', '[random_value]')}`).join('\n')}

// Then execute the original calculation code:
${code}

// Then run the eval function:
${current.eval}

ERROR ANALYSIS:
${lastError.includes('parameters failed validation') ? `
VALIDATION FAILURE: The generated parameter values don't satisfy the eval function constraints.
- The eval function returned false/failed for the generated values
- Need to understand what mathematical relationships the eval function enforces
- Focus on generating values that make the eval function return true
- Example: If eval checks "Ba2_conc > 0.1 && Mg2_conc < 0.02", then ensure parameter ranges satisfy these conditions
` : lastError.includes('already been declared') ? `
NAMING CONFLICT: Variable naming conflict between:
1. Parameter declarations: const ${Object.keys(current.inputs).join(', const ')}
2. Variables in the original calculation code  
3. Variables referenced in the eval function

SOLUTION: Use different parameter names or rename conflicting variables.
` : `
UNKNOWN ERROR: Analyze the error message and determine the root cause.
`}
` : ''}

${previousAttempts && previousAttempts.length > 0 ? `
PREVIOUS PLANNING ATTEMPTS:
${previousAttempts.map((attempt, i) => `
Attempt ${attempt.attempt}: Generated ${attempt.runsGenerated}/${attempt.targetRuns} runs
- Used inputs: ${JSON.stringify(attempt.inputs, null, 2)}
- Result: ${attempt.success ? 'Success' : 'Failed'}
${attempt.plan ? `- Plan: ${attempt.plan.join('; ')}` : ''}
${attempt.error ? `- Error: ${attempt.error}` : ''}
`).join('')}

LEARNING FROM HISTORY: The above attempts show what ranges have been tried and their success rates. Make this attempt MORE AGGRESSIVE in expanding ranges while still respecting the rules.
` : ''}

PROBLEM:
The current RNG ranges are failing validation checks in the eval function. The generated parameter values are not meeting the mathematical constraints required by the calculation.

${previousAttempts && previousAttempts.length > 0 ? 'IMPORTANT: This is attempt ' + (previousAttempts.length + 1) + '/3. Focus on UNDERSTANDING THE VALIDATION FAILURE rather than just expanding ranges.' : ''}

VALIDATION FAILURE ANALYSIS:
${lastError && lastError.includes('parameters failed validation') ? `
The specific error "parameters failed validation" means:
1. Generated parameter values don't satisfy the mathematical constraints in the eval function
2. The eval function is returning false/failing for the generated values
3. Need to analyze what conditions the eval function checks and ensure parameters meet them

EVAL FUNCTION ANALYSIS (CRITICAL):
Look at this eval function: ${current.eval}

This function defines what makes parameters VALID. Analyze:
- What mathematical relationships must be true?
- What ranges or bounds are enforced?
- What ratios or proportions are required?
- Are there minimum/maximum constraints?
- Do values need specific relationships to each other?

SOLUTION STRATEGY: Generate parameters that will make the eval function return TRUE, not just wider ranges.

VALIDATION DEBUGGING TIPS:
- If eval checks ranges (e.g., Ba2_conc > 0.1), ensure parameter ranges can generate values in that range
- If eval checks ratios (e.g., Ba2_conc/Mg2_conc > 10), ensure parameters can create valid ratios
- If eval checks calculations (e.g., final_conc > 0.01), trace through the calculation with sample values
- If eval checks precision (e.g., toFixed(3)), ensure generated values work with rounding
- Consider edge cases and boundary conditions that make validation pass
` : `
RANGE EXPANSION NEEDED: Current ranges are too restrictive and rarely yield acceptable runs under the eval function.
`}

TASK:
1) ANALYZE THE EVAL FUNCTION: Understand what mathematical conditions make validation pass
2) IDENTIFY THE ROOT CAUSE: Why are the current parameter ranges failing validation?  
3) Generate 3 alternative sets that TARGET THE VALIDATION REQUIREMENTS, not just wider ranges
4) CRITICAL VARIABLE CONFLICT RESOLUTION: 
   - If the error shows "Identifier 'X' has already been declared", analyze the ORIGINAL CODE above
   - Find what variables are already declared in the original code (const, let, var)
   - Do NOT use those same variable names in your parameter inputs
   - USE THE EXACT variable names that the calculation code and eval function expect (e.g., if eval uses 'Mg2_conc', use 'Mg2_conc' not 'rng_Mg2')
5) Include ALL parameters that the eval function references. Look at the eval function and ensure every variable it uses has a corresponding input.
6) Keep constants mandated by SUBJECT RULES fixed (but rename them to avoid conflicts).
7) Return STRICT JSON.

VARIABLE NAMING STRATEGY:
- Original code variables: Keep as-is in the original code
- Parameter inputs: Use the EXACT names the calculation code and eval function expect (NO PREFIXES)
- Constants from subject rules: Use their exact names as expected by the code

IMPORTANT: The eval function references constants and variables that must be provided as inputs even if they're not randomized. Analyze the eval function carefully and include ALL referenced variables using their EXACT names (no prefixes like 'rng_').

OUTPUT (STRICT JSON only):
{ 
  "plan": [string], 
  "alternatives": [
    { "name": string, "inputs": { "<name>": "<Math.random expression>" } },
    { "name": string, "inputs": { "<name>": "<Math.random expression>" } },
    { "name": string, "inputs": { "<name>": "<Math.random expression>" } }
  ]
}`

    console.log('📝 Planning prompt length:', planPrompt.length)

    const planSchema = {
      type: 'json_schema',
      json_schema: {
        name: 'planning_response',
        schema: {
          type: 'object',
          properties: {
            plan: { type: 'array', items: { type: 'string' }, minItems: 1 },
            alternatives: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  inputs: { type: 'object', additionalProperties: { type: 'string' } }
                },
                required: ['name', 'inputs'],
                additionalProperties: false
              },
              minItems: 3,
              maxItems: 3
            }
          },
          required: ['plan', 'alternatives'],
          additionalProperties: false
        }
      }
    }

    console.log('🤖 Calling planning model:', process.env.PLAN_MODEL || 'o3')
    
    const planResponse = await aiComplete({
      messages: [{ role: 'user', content: planPrompt }],
      model: process.env.PLAN_MODEL || 'o3',
      max_tokens: 8000,
      response_format: planSchema,
      reasoning_effort: 'medium',
      userId: req.user.id,
      sessionId: req.sessionId,
      endpoint: '/api/plan-params',
      questionId: req.body?.questionId || null
    })

    console.log('📤 Raw planning response length:', planResponse?.length || 0)
    console.log('📤 Raw planning response preview:', (planResponse || '').substring(0, 200) + '...')

    if (!planResponse || planResponse.trim().length === 0) {
      console.error('❌ Empty response from planning model')
      return res.status(500).json({ error: 'Planning model returned empty response' })
    }

    let parsed
    try {
      parsed = JSON.parse(planResponse)
      console.log('✅ Successfully parsed planning JSON')
      console.log('📊 Plan bullets:', parsed.plan?.length || 0)
      console.log('📊 Alternatives:', parsed.alternatives?.length || 0)
    } catch (parseError) {
      console.error('❌ Failed to parse planning JSON:', parseError.message)
      console.error('📤 Problematic response:', planResponse.substring(0, 500))
      return res.status(500).json({ error: 'Failed to parse planning response: ' + parseError.message })
    }

    // Use the first alternative as the default
    const selectedInputs = parsed.alternatives?.[0]?.inputs || {}
    console.log('🎯 Selected inputs from alternative 1:', Object.keys(selectedInputs))

    return res.json({ 
      ok: true,
      plan: parsed.plan, 
      inputs: selectedInputs,
      alternatives: parsed.alternatives,
      raw: planResponse 
    })
  } catch (error) {
    console.error('❌ Planning error:', error.message)
    console.error('🔍 Error stack:', error.stack)
    return res.status(500).json({ error: error.message })
  }
})


// Helper function to parse questions from text format (for Groq)
function parseQuestionsFromText(text, expectedCount) {
  console.log('📝 Parsing questions from text format...')
  const questions = []
  
  // Ensure text is a string
  if (!text || typeof text !== 'string') {
    console.error('❌ parseQuestionsFromText: text is not a string:', typeof text, text)
    return []
  }
  
  const normalizeBlock = (s) => {
    if (!s) return ''
    // Convert visible \n into real newlines, trim trailing spaces
    let out = String(s).replace(/\\n/g, '\n').replace(/\r/g, '')
    // Collapse 3+ newlines to double
    out = out.replace(/\n{3,}/g, '\n\n')
    return out.trim()
  }
  
  // Split by question markers
  const sections = text.split(/(?:Question\s+\d+|Q\d+|^\d+[\.\)])/i)
  
  for (let i = 1; i < sections.length && questions.length < expectedCount; i++) {
    const section = sections[i].trim()
    
    // Look for worked solution marker
    const solutionMatch = section.match(/(.*?)(?:Worked\s+Solution|Solution|Answer)(.*)/is)
    
    if (solutionMatch) {
      const question = normalizeBlock(solutionMatch[1])
      const workedSolution = normalizeBlock(solutionMatch[2])
      
      if (question && workedSolution) {
        questions.push({ question, workedSolution })
      }
    } else if (section.length > 50) {
      // Fallback: treat entire section as question
      const half = Math.floor(section.length / 2)
      questions.push({ 
        question: normalizeBlock(section.substring(0, half)),
        workedSolution: normalizeBlock(section.substring(half))
      })
    }
  }
  
  console.log(`📊 Parsed ${questions.length} questions from text`)
  return questions
}

// Step 5: Generate final questions with Groq/GPT
app.post('/api/compose-qa', async (req, res) => {
  console.log('🎯 /api/compose-qa endpoint called!')
  console.log('📊 Request body keys:', Object.keys(req.body))
  console.log('🔍 questionId from body:', req.body?.questionId)
  try {
    const { question, workedSolution, code, subjectRules, questionRules, runs, n, model } = req.body
    
    if (!runs || !runs.length) {
      return res.status(400).json({ error: 'runs array required' })
    }

    const count = Math.min(n || runs.length, runs.length)
    const selectedRuns = runs.slice(0, count)

    const runsData = selectedRuns.map((run, i) => {
      const logs = String(run.logs || '').slice(0, 2000)
      return `Run ${i + 1}: ${JSON.stringify(run.params)} → Final: ${run.final}\nLogs (truncated):\n${logs}`
    }).join('\n\n')

    const qaPrompt = `Generate ${count} different exam questions and answers based on these calculation runs.

CRITICAL DATA USAGE RULES:
- You MUST use the EXACT parameter values from each run's JSON data
- You MUST ensure the final answer matches the "Final" value from that run
- Do NOT create new numbers - use only the provided parameter values
- The worked solution should show how the provided parameters lead to the provided final answer

ADDITIONAL CONTEXT TO STRICTLY FOLLOW:
- VERIFIED CALCULATION CODE (reference this logic; do not invent a new method):
\n\n--- BEGIN CODE ---\n\n${String(code || '').slice(0, 12000)}\n\n--- END CODE ---\n\n
- AUTHORITATIVE WORKED SOLUTION STYLE (mirror structure and phrasing closely; adapt numbers per run but keep phrasing style):
\n\n--- BEGIN WORKED SOLUTION ---\n\n${String(workedSolution || '').slice(0, 8000)}\n\n--- END WORKED SOLUTION ---\n\n
- CONSOLE-LOGGED RUN ANSWERS (final numeric targets for each run): already embedded below with each run as "Final".

EXAMPLE: If Run 1 shows: {"mass_mixture": 3.4, "volume_HCl_cm3": 45.2, "conc_HCl": 1.14, "vol_NaOH_cm3": 23.58} → Final: 45.3
Then Question 1 MUST use: "3.4 g mixture", "45.2 cm³ of 1.14 mol dm⁻³ HCl", "23.58 cm³ of NaOH", and result in 45.3%

BASE QUESTION: ${question}
SUBJECT RULES (MUST FOLLOW): ${subjectRules}
QUESTION RULES (MUST FOLLOW): ${questionRules}

CALCULATION RUNS:
${runsData}

REQUIREMENTS (FORMAT STRICTNESS):
1. Use the EXACT numerical values from each run
2. Create different contexts/scenarios for each question
3. Keep the same calculation principle and method from the original question
4. QUESTION TEXT: Adjust wording/context for variability; ensure logical sense and scientific accuracy; do not change the underlying calculation method.
5. WORKED SOLUTION TEXT: Follow the authoritative worked solution’s structure and step order closely; reuse phrasing; adapt only numbers/units; do not invent new methods or steps
6. Follow the subject rules for unit notation and formatting exactly
7. Include complete worked solutions with proper notation
8. Each question should use a different run's values
9. Maintain consistent formatting according to subject rules throughout
10. Make each question feel like it comes from a different textbook or exam board

OUTPUT FORMAT (STRICT JSON ONLY):
{ "items": [ { "question": string, "workedSolution": string } ] }

CONTENT REQUIREMENTS:
- Each item must correspond to one run and use EXACT run parameter values
- Provide clear step-by-step worked solutions; include units and proper notation
- No extra keys or commentary outside the JSON shape

ROUNDING / SYMBOLS / NEWLINES:
- Use ASCII characters only for math (no LaTeX delimiters, no Unicode fraction glyphs). Examples: "^", "*", "/", "%", "+", "-".
- Do not use LaTeX inline blocks like \\( ... \\) or display blocks like \\[ ... \\].
- Where superscripts are needed in prose, prefer plain text (e.g., cm^3, mol dm^-3) rather than Unicode superscripts.
- Final numeric answers must follow the significant figure rules in SUBJECT RULES (intermediate 5 s.f., final 3 s.f.).
- To preserve layout, use explicit newline characters ("\n") between steps and paragraphs. Do NOT embed HTML tags; just use plain text with numbered steps.

WORKED SOLUTION STYLE GUIDE (MIRROR THIS STRUCTURE CLOSELY FROM THE AUTHORITATIVE WORKED SOLUTION ABOVE):
1. Start with "Data provided:" followed by bullet-like lines (each on a new line)
2. Numbered steps (1., 2., 3., ...) that mirror the logic of the authoritative solution
3. Show intermediate calculations with units; keep intermediate values to 5 s.f., final to 3 s.f.
4. Close with a final line starting with "Answer:" that states the result and unit/percentage

Generate exactly ${count} items.`

    // Request QA in strict JSON schema format
    const qaSchema = {
      type: "json_schema",
      json_schema: {
        name: "qa_generation_response",
        schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  question: { type: "string" },
                  workedSolution: { type: "string" }
                },
                required: ["question", "workedSolution"],
                additionalProperties: false
              },
              minItems: 1
            }
          },
          required: ["items"],
          additionalProperties: false
        }
      }
    }

    const selectedModel = model || process.env.QA_MODEL || 'groq'
    const useGroq = selectedModel === 'groq'
    
    console.log('🤖 Using model for QA generation:', selectedModel)
    
    console.log('🔍 DEBUG: About to call aiComplete for compose-qa with:', {
      userId: req.user.id,
      sessionId: req.sessionId,
      endpoint: '/api/compose-qa',
      questionId: req.body?.questionId || null,
      model: selectedModel
    })
    
    const analyticsStart = Date.now()
    const aiResult = await aiComplete({
      messages: [{ role: 'user', content: qaPrompt }],
      model: selectedModel,
      max_tokens: useGroq ? 8192 : 4000,
      response_format: useGroq ? null : qaSchema,
      temperature: useGroq ? 1 : 0.7,
      stream: false, // Disable streaming for structured JSON output
      userId: req.user.id,
      sessionId: req.sessionId,
      endpoint: '/api/compose-qa',
      questionId: req.body?.questionId || null,
      // We'll log explicitly below to guarantee a row even if parsing fails
      skipAnalytics: true
    })
    
    console.log('✅ DEBUG: aiComplete for compose-qa completed successfully')

    // Extract content and usage from the result
    const qaResponseRaw = aiResult.content || aiResult
    const usageData = aiResult.usage || null
    
    let qaResponse
    if (useGroq) {
      // Parse Groq response manually
      try {
        const qaParsed = JSON.parse(qaResponseRaw)
        qaResponse = qaParsed.items || qaParsed
      } catch (parseError) {
        console.log('⚠️ Groq JSON parsing failed, trying text extraction...')
        console.log('🔍 DEBUG: qaResponseRaw type:', typeof qaResponseRaw, 'value:', qaResponseRaw)
        // Fallback: extract questions from text format
        const textToparse = (typeof qaResponseRaw === 'string') ? qaResponseRaw : String(qaResponseRaw || '')
        qaResponse = parseQuestionsFromText(textToparse, count)
      }
    } else {
      // OpenAI structured response
      try {
        const qaParsed = JSON.parse(qaResponseRaw)
        qaResponse = qaParsed.items
      } catch (parseError) {
        console.error('❌ OpenAI JSON parsing failed:', parseError.message)
        console.log('🔍 DEBUG: qaResponseRaw type:', typeof qaResponseRaw, 'value:', qaResponseRaw)
        throw new Error(`Failed to parse OpenAI response: ${parseError.message}`)
      }
    }

    // Validate that the generated questions use the correct parameters
    let validationWarnings = []
    selectedRuns.forEach((run, index) => {
      const expectedFinal = run.final
      const questionText = qaResponse
      
      // Check if the question mentions values close to the run parameters
      const hasMatchingValues = Object.values(run.params).some(paramValue => {
        if (typeof paramValue === 'number') {
          const valueStr = paramValue.toString()
          return questionText.includes(valueStr) || questionText.includes(paramValue.toFixed(1)) || questionText.includes(paramValue.toFixed(2))
        }
        return false
      })
      
      if (!hasMatchingValues) {
        validationWarnings.push(`Question ${index + 1} may not be using the correct parameter values from Run ${index + 1}`)
      }
    })

    // Explicit analytics log right before returning to UI
    try {
      // Count the actual number of questions generated
      const actualQuestionsGenerated = Array.isArray(qaResponse) ? qaResponse.length : 0
      
      await logApiCall(
        req.user.id,
        req.sessionId,
        '/api/compose-qa',
        selectedModel,
        aiResult.startTime || analyticsStart,
        Date.now(),
        true,
        usageData,
        null,
        req.body?.questionId || null,
        actualQuestionsGenerated
      )
    } catch (logErr) {
      console.error('❌ Compose QA analytics logging failed:', logErr)
    }

    res.json({
      ok: true,
      qa: qaResponse,
      count: count,
      runsUsed: selectedRuns.length,
      validation: validationWarnings.length > 0 ? validationWarnings : ["All questions appear to use correct parameter values"],
      expectedAnswers: selectedRuns.map((run, i) => `Question ${i + 1} should have final answer: ${run.final}%`)
    })

  } catch (error) {
    console.error('❌ Compose QA error:', error.message)
    
    try {
      await logApiCall(
        req.user?.id || null,
        req.sessionId || null,
        '/api/compose-qa',
        (req.body?.model || process.env.QA_MODEL || 'groq'),
        analyticsStart || (Date.now() - 1000),
        Date.now(),
        false,
        null,
        { type: 'compose_error', message: error.message },
        req.body?.questionId || null,
        0 // No questions generated due to error
      )
    } catch (_) {}
    res.status(500).json({ error: error.message })
  }
})

// Serve the frontend for all other routes
app.get('*', (req, res) => {
  console.log('📄 Serving frontend:', req.path)
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

const PORT = Number(process.env.MINI_PORT || 4000)
console.log('\n🚀 === SERVER STARTUP ===')
console.log('🌐 Starting server on port:', PORT)
console.log('📁 Static files from:', path.join(__dirname, 'public'))
console.log('🔗 Access at: http://localhost:' + PORT)

app.listen(PORT, () => {
  console.log('✅ Server running successfully!')
  console.log('🎯 Ready to accept requests')
  console.log('=====================================\n')
})