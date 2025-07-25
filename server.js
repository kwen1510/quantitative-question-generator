const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB Configuration
const uri = `mongodb+srv://${process.env.MONGO_DB_USERNAME}:${process.env.MONGO_DB_PASSWORD}@cluster0.bwtbeur.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
let db;
let client;

// Initialize MongoDB connection
async function connectToMongoDB() {
  try {
    if (db && client && client.topology && client.topology.isConnected()) {
      return db;
    }
    
    client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    
    await client.connect();
    db = client.db('calculation_validator');
    console.log('Connected to MongoDB');
    return db;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

// Helper function to ensure database connection
async function ensureDbConnection() {
  if (!db) {
    await connectToMongoDB();
  }
  return db;
}

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_KEY,
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Serve the main HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint to save context to MongoDB
app.post('/api/save-context', async (req, res) => {
  try {
    const { name, question, context, tags = [], description = '' } = req.body;
    
    if (!name || !question) {
      return res.status(400).json({ error: 'Name and question are required' });
    }
    
    const contextData = {
      name: name.trim(),
      question: question.trim(),
      context: context ? context.trim() : '',
      tags: tags.map(tag => tag.trim()),
      description: description.trim(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const database = await ensureDbConnection();
    const result = await database.collection('contexts').insertOne(contextData);
    
    res.json({
      success: true,
      id: result.insertedId,
      message: 'Context saved successfully'
    });
    
  } catch (error) {
    console.error('Error saving context:', error);
    res.status(500).json({ error: 'Failed to save context' });
  }
});

// API endpoint to get all saved contexts
app.get('/api/contexts', async (req, res) => {
  try {
    const database = await ensureDbConnection();
    const contexts = await database.collection('contexts')
      .find({})
      .sort({ updatedAt: -1 })
      .limit(100)
      .toArray();
    
    res.json({ contexts });
    
  } catch (error) {
    console.error('Error fetching contexts:', error);
    res.status(500).json({ error: 'Failed to fetch contexts' });
  }
});

// API endpoint to get a specific context by ID
app.get('/api/contexts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid context ID' });
    }
    
    const database = await ensureDbConnection();
    const context = await database.collection('contexts').findOne({ _id: new ObjectId(id) });
    
    if (!context) {
      return res.status(404).json({ error: 'Context not found' });
    }
    
    res.json({ context });
    
  } catch (error) {
    console.error('Error fetching context:', error);
    res.status(500).json({ error: 'Failed to fetch context' });
  }
});

// API endpoint to update a context
app.put('/api/contexts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, question, context, tags = [], description = '' } = req.body;
    
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid context ID' });
    }
    
    if (!name || !question) {
      return res.status(400).json({ error: 'Name and question are required' });
    }
    
    const updateData = {
      name: name.trim(),
      question: question.trim(),
      context: context ? context.trim() : '',
      tags: tags.map(tag => tag.trim()),
      description: description.trim(),
      updatedAt: new Date()
    };
    
    const database = await ensureDbConnection();
    const result = await database.collection('contexts').updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Context not found' });
    }
    
    res.json({
      success: true,
      message: 'Context updated successfully'
    });
    
  } catch (error) {
    console.error('Error updating context:', error);
    res.status(500).json({ error: 'Failed to update context' });
  }
});

// API endpoint to delete a context
app.delete('/api/contexts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid context ID' });
    }
    
    const database = await ensureDbConnection();
    const result = await database.collection('contexts').deleteOne({ _id: new ObjectId(id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Context not found' });
    }
    
    res.json({
      success: true,
      message: 'Context deleted successfully'
    });
    
  } catch (error) {
    console.error('Error deleting context:', error);
    res.status(500).json({ error: 'Failed to delete context' });
  }
});

// API endpoint to validate JavaScript calculation
app.post('/api/validate-calculation', async (req, res) => {
  try {
    const { question, context, jsCode, result } = req.body;
    
    if (!question || !jsCode || !result) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const prompt = `
You are a mathematics and JavaScript code validator. Please check if the following JavaScript calculation is correct:

Question: ${question}
${context ? `Additional Context: ${context}` : ''}

JavaScript Code:
${jsCode}

Result/Output:
${result}

Please respond with:
1. "CORRECT" if the calculation and logic are accurate
2. "INCORRECT" if there are errors, followed by a brief explanation of what's wrong
3. If incorrect, suggest how to fix the calculation

Be thorough in checking the mathematical logic and JavaScript syntax.`;

    const message = await anthropic.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const validation = message.content[0].text;
    const isCorrect = validation.toLowerCase().includes('correct') && !validation.toLowerCase().includes('incorrect');

    res.json({
      isCorrect,
      validation,
      feedback: validation
    });

  } catch (error) {
    console.error('Error validating calculation:', error);
    res.status(500).json({ error: 'Failed to validate calculation' });
  }
});

// API endpoint to generate JavaScript code for a question
app.post('/api/generate-javascript', async (req, res) => {
  try {
    const { question, context } = req.body;
    
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const prompt = `
You are a JavaScript code generator for mathematical calculations. Generate JavaScript code to solve the following:

Question: ${question}
${context ? `Additional Context: ${context}` : ''}

Requirements:
1. Write clear, step-by-step JavaScript code
2. Include console.log statements for each step of the calculation
3. Use descriptive variable names
4. Add comments explaining the logic
5. Make sure the code is executable and produces the final answer
6. Use only standard JavaScript (Math object is allowed)
7. Return the result using console.log at the end
8. Use proper variable declarations (let, const)

Provide ONLY the JavaScript code, no explanations or markdown formatting.`;

    const message = await anthropic.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const jsCode = message.content[0].text.trim();

    res.json({
      jsCode
    });

  } catch (error) {
    console.error('Error generating JavaScript code:', error);
    res.status(500).json({ error: 'Failed to generate JavaScript code' });
  }
});

// API endpoint to test question values by generating and executing code
app.post('/api/test-question-values', async (req, res) => {
  try {
    const { questionText, context } = req.body;
    
    if (!questionText) {
      return res.status(400).json({ error: 'Question text is required' });
    }

    // Generate JavaScript code for the question
    const codeResponse = await fetch(`${req.protocol}://${req.get('host')}/api/generate-javascript`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ question: questionText, context }),
    });

    if (!codeResponse.ok) {
      throw new Error('Failed to generate code for testing');
    }

    const codeData = await codeResponse.json();
    const jsCode = codeData.jsCode;

    // Test the generated code execution
    // Declare originalLog outside try block for proper scope
    const originalLog = console.log;
    
    try {
      // Create a simple test environment
      let output = '';
      
      console.log = function(...args) {
        const logMessage = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        output += logMessage + '\n';
        originalLog.apply(console, args);
      };

      // Execute the code
      eval(jsCode);
      
      // Restore original console.log
      console.log = originalLog;

      const result = output.trim();
      
      // Check if we got a reasonable result (not empty, not error)
      if (result && !result.toLowerCase().includes('error') && !result.toLowerCase().includes('nan') && !result.toLowerCase().includes('undefined')) {
        res.json({
          success: true,
          jsCode,
          result,
          questionText
        });
      } else {
        res.json({
          success: false,
          error: 'Generated code did not produce valid results',
          jsCode,
          result
        });
      }

    } catch (execError) {
      // Restore original console.log in case of error
      console.log = originalLog;
      res.json({
        success: false,
        error: 'Code execution failed: ' + execError.message,
        jsCode
      });
    }

  } catch (error) {
    console.error('Error testing question values:', error);
    res.status(500).json({ error: 'Failed to test question values' });
  }
});

// API endpoint to generate a single question based on validated sample
app.post('/api/generate-single-question', async (req, res) => {
  try {
    const { originalQuestion, context, jsCode, result, questionNumber } = req.body;
    
    if (!originalQuestion || !jsCode || !result) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const contextVariations = [
      'antacid tablet analysis',
      'swimming pool chemical testing', 
      'soil sample analysis',
      'food additive quality control',
      'water treatment plant testing',
      'pharmaceutical quality control',
      'agricultural lime testing',
      'cleaning product analysis'
    ];

    const selectedContext = contextVariations[(questionNumber - 1) % contextVariations.length];

    const prompt = `
You are a chemistry teacher's assistant specializing in back-titration practice questions.

ORIGINAL VALIDATED QUESTION AND SOLUTION:
Question: ${originalQuestion}

Context/Constraints: ${context || 'Standard chemistry calculation constraints'}

Working JavaScript Code:
${jsCode}

Correct Result:
${result}

TASK: Generate 1 NEW similar back-titration question with the following requirements:

1. **Same stoichiometry and calculation method** as the original
2. **Different numerical values** - vary by small amounts (±15%) to keep percentage between 20-80%
3. **Context**: ${selectedContext}
4. **Same units and format**: cm³ for volumes, mol dm⁻³ for concentrations, g for mass
5. **Same significant figures**: 3 s.f. for final answers, 5 s.f. for intermediate steps
6. **Include full worked solution** with step-by-step calculations
7. **Volumetric flask must be exactly 250 cm³**
8. **Pipette must be exactly 25.0 cm³**
9. **Burette readings must end in .00 or .05 and be between 10.00-45.00 cm³**

Format as:
QUESTION:
[Context and question text]

SOLUTION:
[Complete step-by-step working with calculations]
[Final answer to 3 s.f.]

Provide the complete question with solution.`;

    const message = await anthropic.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const question = message.content[0].text.trim();

    res.json({
      question,
      questionNumber
    });

  } catch (error) {
    console.error('Error generating single question:', error);
    res.status(500).json({ error: 'Failed to generate single question' });
  }
});

// Legacy endpoint for backward compatibility (now just calls single question)
app.post('/api/generate-questions', async (req, res) => {
  try {
    const { originalQuestion, context, jsCode, result, count = 1 } = req.body;
    
    if (!originalQuestion || !jsCode || !result) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (count === 1) {
      // For single questions, use the single question endpoint logic
      const response = await fetch(`${req.protocol}://${req.get('host')}/api/generate-single-question`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          originalQuestion,
          context,
          jsCode,
          result,
          questionNumber: 1
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate question');
      }

      const data = await response.json();
      res.json({
        questions: data.question,
        count: 1
      });
    } else {
      // For multiple questions, client should call generate-single-question multiple times
      res.status(400).json({ 
        error: 'Use generate-single-question endpoint for multiple questions to avoid context window issues' 
      });
    }

  } catch (error) {
    console.error('Error generating questions:', error);
    res.status(500).json({ error: 'Failed to generate questions' });
  }
});

// For Vercel deployment - export the app
module.exports = app;

// Only start the server if running locally (not on Vercel)
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, async () => {
    try {
      await connectToMongoDB();
      console.log(`Server running on http://localhost:${PORT}`);
      console.log('Make sure to set your ANTHROPIC_KEY, MONGO_DB_USERNAME, and MONGO_DB_PASSWORD in the .env file');
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  });
} else {
  // For Vercel, connect to MongoDB when the module loads
  connectToMongoDB().catch(error => {
    console.error('MongoDB connection failed in Vercel environment:', error);
  });
} 