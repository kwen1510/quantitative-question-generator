# ChemCalc Pro - AI-Powered Chemistry Question Generator

A sophisticated chemistry calculation validator with MongoDB context management and AI-powered validation using Anthropic's Claude. Perfect for educators, institutions, and educational technology companies.

## 🚀 Features

### Core Functionality
- **AI-Powered Code Generation**: Automatically generates JavaScript code for chemistry calculations
- **Intelligent Validation**: Uses Anthropic's Claude to validate mathematical logic and syntax
- **Question Generation**: Creates multiple similar practice questions with varied numerical values
- **Detailed Progress Tracking**: Real-time progress display during question generation

### Enhanced Features ✨
1. **📚 Context Management**
   - Save and load question contexts to MongoDB
   - Edit and delete saved contexts
   - Tag-based organization with descriptions
   - Full CRUD operations for context templates

2. **🔍 API Key Protection**
   - Automatic detection of exposed API keys before Git commits
   - Real-time security scanning for OpenAI, Anthropic, and other API patterns
   - Smart .gitignore to protect environment variables
   - Safe deployment preparation

3. **⚡ Professional UI/UX**
   - Modern gradient design with smooth animations
   - Responsive mobile-friendly interface
   - Real-time progress indicators for each question
   - Professional modal dialogs and form validation
   - Commercial-ready design optimized for deployment

4. **🚀 Deployment Ready**
   - Optimized for Vercel serverless deployment
   - MongoDB connection pooling for serverless environments
   - Automatic scaling and performance optimization
   - Built-in error handling and recovery

## 🚀 Production Deployment

### Quick Deploy to Vercel

This application is optimized for **Vercel** deployment with serverless functions.

#### Prerequisites
- Vercel account ([sign up here](https://vercel.com))
- GitHub repository with your code
- MongoDB Atlas cluster (for context management)
- Anthropic API key

#### Quick Start
1. **Check for API key exposure:**
   ```bash
   npm run check-api-keys
   ```

2. **Deploy via Vercel CLI:**
   ```bash
   npm install -g vercel
   vercel login
   vercel
   ```

3. **Set environment variables in Vercel dashboard:**
   - `ANTHROPIC_KEY`
   - `MONGO_DB_USERNAME`
   - `MONGO_DB_PASSWORD`

4. **Redeploy after setting variables**

📋 **For comprehensive deployment instructions, troubleshooting, and best practices, see [DEPLOYMENT.md](./DEPLOYMENT.md)**

### Deployment Features
- ⚡ **Serverless**: Automatically scales with demand
- 🌍 **Global CDN**: Fast loading worldwide
- 🔒 **Automatic HTTPS**: Secure by default
- 📊 **Analytics**: Built-in performance monitoring
- 🔄 **Auto-deploy**: Updates on every git push

## 🛠️ Setup Instructions

### Prerequisites
- Node.js (v14 or higher)
- MongoDB Atlas account (or local MongoDB instance)
- Anthropic API key

### Installation

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Environment Configuration:**
   Create a `.env` file in the root directory:
   ```env
   # Anthropic API Configuration
   ANTHROPIC_KEY=your_anthropic_api_key_here
   
   # MongoDB Configuration (for context management)
   MONGO_DB_USERNAME=your_mongo_username
   MONGO_DB_PASSWORD=your_mongo_password
   
   # Application Configuration
   PORT=3000
   NODE_ENV=development
   ```

3. **Start the application:**
   ```bash
   npm start
   # or for development
   npm run dev
   ```

4. **Access the application:**
   Open http://localhost:3000 in your browser

5. **Check for API key exposure (before Git commits):**
   ```bash
   npm run check-api-keys
   ```

## 📖 Usage Guide

### Basic Workflow
1. **Load or Create Context**: Use "Load Saved Context" to reuse templates or start fresh
2. **Input Question**: Enter your chemistry calculation question
3. **Add Context**: Provide calculation constraints and requirements
4. **Save Context** (Optional): Click "Save Current Context" to store for future use
5. **Generate & Validate**: AI generates and validates JavaScript code with real-time progress
6. **Review Sample**: Examine the generated sample question
7. **Generate More**: Create 4 additional practice questions with detailed progress tracking
8. **Copy & Use**: Copy questions to clipboard for immediate use

### Context Management
- **Save Context**: Click "💾 Save Current Context" to store question templates with names, descriptions, and tags
- **Load Context**: Click "📂 Load Saved Context" to browse and load previous templates
- **Edit/Delete**: Manage saved contexts with full editing capabilities and organization
- **Tags**: Organize contexts with searchable tags for easy categorization

### Progress Tracking
- **Real-time Updates**: Watch each question generation step in real-time
- **Visual Indicators**: Color-coded progress steps show generation, code creation, testing, and completion
- **Error Handling**: Clear error messages with automatic retry mechanisms
- **Individual Results**: Each question displays separately as it's completed

## 🗄️ Database Schema

### Contexts Collection
```javascript
{
  "_id": ObjectId,
  "name": String,              // Context name/title
  "question": String,          // Main question text
  "context": String,           // Additional context/constraints
  "tags": [String],           // Searchable tags
  "description": String,       // Optional description
  "createdAt": Date,          // Creation timestamp
  "updatedAt": Date           // Last modification timestamp
}
```

## 🔧 API Endpoints

### Context Management
- `GET /api/contexts` - Retrieve all saved contexts
- `GET /api/contexts/:id` - Get specific context by ID
- `POST /api/save-context` - Create new context
- `PUT /api/contexts/:id` - Update existing context
- `DELETE /api/contexts/:id` - Delete context

### Core Calculation Endpoints
- `POST /api/validate-calculation` - Validate JavaScript calculations with AI
- `POST /api/generate-javascript` - Generate JavaScript code for questions
- `POST /api/test-question-values` - Test question value generation
- `POST /api/generate-single-question` - Generate individual practice questions
- `POST /api/generate-questions` - Legacy endpoint for backward compatibility

## 🎯 Suggested Improvements

### 1. **Advanced Search & Filtering**
```javascript
// Implement full-text search for contexts
POST /api/contexts/search
{
  "query": "titration",
  "tags": ["chemistry", "acid-base"],
  "dateRange": { "start": "2024-01-01", "end": "2024-12-31" }
}
```

### 2. **User Authentication & Multi-tenancy**
- JWT-based authentication
- User-specific context storage
- Role-based access control
- Team collaboration features

### 3. **Advanced Analytics**
```javascript
// Track usage patterns and success rates
{
  "contextUsage": { "mostUsed": [], "success_rate": 0.95 },
  "questionGeneration": { "average_time": "2.3s", "error_rate": 0.02 },
  "userActivity": { "daily_active": 150, "questions_generated": 1250 }
}
```

### 4. **Enhanced Document Generation**
- PDF export with LaTeX math rendering
- Customizable templates (exam format, homework format)
- Batch processing for multiple question sets
- Integration with Google Docs/Microsoft 365

### 5. **Question Quality Improvements**
- Difficulty level classification
- Topic categorization (acid-base, redox, etc.)
- Adaptive question generation based on user performance
- Answer validation with multiple solution paths

### 6. **Collaboration Features**
- Share contexts between users
- Comment and review system
- Version control for question sets
- Export to LMS platforms (Canvas, Blackboard)

### 7. **Mobile Optimization**
- Progressive Web App (PWA) capabilities
- Offline mode for basic calculations
- Touch-optimized interface
- Camera integration for equation scanning

### 8. **Integration Enhancements**
- LMS integration (Canvas, Moodle, etc.)
- Gradebook synchronization
- Plagiarism detection for generated content
- API for third-party applications

### 9. **Advanced Security Features**
```javascript
// Enhanced security monitoring
{
  "anomalyDetection": true,
  "ipWhitelisting": ["192.168.1.0/24"],
  "contentFiltering": {
    "profanityFilter": true,
    "academicIntegrityCheck": true
  }
}
```

### 10. **Performance Optimizations**
- Redis caching for frequently accessed contexts
- Database indexing for faster searches
- CDN integration for static assets
- Background job processing for large document generation

## 🚦 Security Features

### Implemented Security Measures
- **API Key Detection** - Automatic scanning for OpenAI, Anthropic, and other API key patterns
- **Environment Variable Protection** - Detects leaked environment variable names and values
- **Git Safety** - Smart .gitignore and pre-commit hooks to prevent sensitive data exposure
- **MongoDB Security** - Parameterized queries and input validation to prevent injection
- **Production-Ready** - Secure environment variable management for deployment

### Security Best Practices
- Store API keys in environment variables (automatically protected by .gitignore)
- Run `npm run check-api-keys` before every Git commit
- Use HTTPS in production (automatic with Vercel)
- Regular dependency updates and security audits
- Secure MongoDB Atlas configuration with proper access controls

**Note**: This application prioritizes functionality and user experience while maintaining essential security for API key protection and safe deployment. The lightweight security approach allows JavaScript code execution via `eval()`, which is essential for the calculation validation features.

## 📊 Performance Considerations

### Current Optimizations
- Limited context retrieval (100 most recent)
- Efficient MongoDB queries with proper indexing
- Chunked file processing for large documents
- Lazy loading of context lists

### Recommended Monitoring
- Monitor API response times
- Track MongoDB connection pool usage
- Watch for memory leaks in document generation
- Monitor rate limiting effectiveness

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Implement your changes with proper tests
4. Update documentation
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 💼 Commercial Use & Licensing

### For Educational Institutions
- **Site License**: Unlimited use within your institution
- **Custom Deployment**: Branded version with your institution's branding
- **Technical Support**: Priority support and training for your staff
- **Custom Features**: Tailored functionality for your specific curriculum needs

### For EdTech Companies
- **White Label Solution**: Complete rebranding and customization
- **API Access**: Integration with existing educational platforms
- **Scalable Infrastructure**: Multi-tenant deployment with user management
- **Revenue Sharing**: Partnership opportunities for distribution

### Enterprise Features Available
- **Single Sign-On (SSO)**: Integration with institutional authentication systems
- **Advanced Analytics**: Detailed usage statistics and performance metrics
- **Bulk Operations**: Import/export large question banks
- **Custom Question Types**: Support for additional chemistry calculation types
- **Advanced Security**: Enhanced security features for enterprise deployment

**Contact**: For licensing inquiries and enterprise features, please reach out for custom pricing and implementation support.

## 🆘 Support

For issues or questions:
1. Check the troubleshooting section
2. Review existing GitHub issues
3. Create a new issue with detailed information
4. Include environment details and error logs

## 🔄 Version History

- **v2.0.0** - Added MongoDB integration, Word document export, security checking
- **v1.0.0** - Initial release with basic calculation validation 