#!/usr/bin/env node

/**
 * API Key Checker Script
 * Simple script to check for exposed API keys before Git commits
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Checking for exposed API keys...\n');

// Files to check (excluding .env which should be gitignored)
const filesToCheck = [
    'server.js',
    'public/app.js',
    'public/index.html',
    'README.md',
    'package.json',
    'scripts/*.js'
];

// API key patterns to detect
const apiKeyPatterns = [
    /sk-[a-zA-Z0-9]{48}/, // OpenAI API keys
    /claude-[a-zA-Z0-9-]{40,}/, // Anthropic API keys
    /ANTHROPIC_KEY\s*=\s*(?!your_anthropic_api_key_here)[a-zA-Z0-9-_]{20,}/, // Environment variables with real values
    /MONGO_DB_PASSWORD\s*=\s*(?!your_mongo_password)[^\s]{8,}/, // MongoDB passwords (not placeholders)
    /API_KEY\s*=\s*(?!your_)[a-zA-Z0-9-_]{20,}/, // Generic API keys (not placeholders)
];

let foundKeys = [];

filesToCheck.forEach(file => {
    if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf8');
        
        apiKeyPatterns.forEach((pattern, index) => {
            if (pattern.test(content)) {
                const patternNames = [
                    'OpenAI API key',
                    'Anthropic API key', 
                    'ANTHROPIC_KEY with value',
                    'MongoDB password',
                    'Generic API key'
                ];
                foundKeys.push({
                    file: file,
                    pattern: patternNames[index],
                    line: content.split('\n').findIndex(line => pattern.test(line)) + 1
                });
            }
        });
    }
});

if (foundKeys.length === 0) {
    console.log('✅ No API keys found in files');
    console.log('✅ Safe to commit to Git');
} else {
    console.log('❌ WARNING: Potential API keys found!');
    console.log('🚨 DO NOT COMMIT TO GIT until these are fixed:\n');
    
    foundKeys.forEach(key => {
        console.log(`❌ ${key.file}:${key.line} - ${key.pattern}`);
    });
    
    console.log('\n📋 How to fix:');
    console.log('1. Move API keys to .env file');
    console.log('2. Add .env to .gitignore');
    console.log('3. Use process.env.VARIABLE_NAME in code');
    console.log('4. Remove hardcoded keys from all files');
}

console.log('\n' + '='.repeat(50));
process.exit(foundKeys.length > 0 ? 1 : 0); 