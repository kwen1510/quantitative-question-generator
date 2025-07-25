class CalculationValidator {
    constructor() {
        this.currentAttempt = 0;
        this.maxAttempts = 3;
        this.currentJSCode = '';
        this.currentResult = '';
        this.originalQuestion = '';
        this.originalContext = '';
        this.executionAttempt = 0;
        this.questionValidationAttempts = 0;
        this.maxQuestionValidationAttempts = 3;
        this.currentEditingContextId = null;
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        document.getElementById('generateBtn').addEventListener('click', () => this.startValidationProcess());
        document.getElementById('runCodeBtn').addEventListener('click', () => this.executeCode());
        document.getElementById('approveBtn').addEventListener('click', () => this.generateFinalQuestions());
        document.getElementById('regenerateBtn').addEventListener('click', () => this.regenerateSampleQuestion());
        document.getElementById('copyAllBtn').addEventListener('click', () => this.copyAllQuestions());
        document.getElementById('startOverBtn').addEventListener('click', () => this.startOver());
        
        // Context management listeners
        document.getElementById('loadContextBtn').addEventListener('click', () => this.showContextModal());
        document.getElementById('saveContextBtn').addEventListener('click', () => this.showSaveContextModal());
        
        // Modal listeners
        document.getElementById('saveContextForm').addEventListener('submit', (e) => this.saveContext(e));
        document.querySelectorAll('.close').forEach(closeBtn => {
            closeBtn.addEventListener('click', (e) => this.closeModal(e));
        });
        
        // Click outside modal to close
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.closeModal(e);
            }
        });
    }

    async startValidationProcess() {
        this.currentAttempt = 0;
        this.executionAttempt = 0;
        this.questionValidationAttempts = 0;
        this.resetUI();
        this.setActiveStep(1);
        this.showLoading(true);

        this.originalQuestion = document.getElementById('question').value.trim();
        this.originalContext = document.getElementById('context').value.trim();

        if (!this.originalQuestion) {
            this.showError('Please enter a question');
            return;
        }

        await this.generateAndValidate(this.originalQuestion, this.originalContext);
    }

    async generateAndValidate(question, context) {
        try {
            // Step 1: Generate JavaScript Code
            this.setActiveStep(1);
            const jsCode = await this.generateJavaScriptCode(question, context);
            this.currentJSCode = jsCode;
            this.displayCode(jsCode);
            this.setStepCompleted(1);

            // Step 2: Auto-execute Code immediately
            this.setActiveStep(2);
            setTimeout(() => this.executeCode(), 500);

        } catch (error) {
            this.showError('Error generating JavaScript code: ' + error.message);
            this.showLoading(false);
        }
    }

    async generateJavaScriptCode(question, context) {
        const response = await fetch('/api/generate-javascript', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ question, context }),
        });

        if (!response.ok) {
            throw new Error('Failed to generate JavaScript code');
        }

        const data = await response.json();
        return data.jsCode;
    }

    executeCode() {
        this.executionAttempt++;
        this.setActiveStep(2);
        this.showLoading(true);

        // Update execution card status
        this.setCardStatus('executionSection', 'processing');
        
        // Clear previous output
        const outputContainer = document.getElementById('codeOutput');
        outputContainer.textContent = `Executing JavaScript code... (Attempt ${this.executionAttempt})`;

        // Execute the JavaScript code
        this.executeJavaScriptCode(this.currentJSCode);
    }

    executeJavaScriptCode(code) {
        // Capture console.log output - declare outside try block for error handler access
        const originalLog = console.log;
        
        try {
            let output = '';
            
            console.log = function(...args) {
                const logMessage = args.map(arg => 
                    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
                ).join(' ');
                output += logMessage + '\n';
                originalLog.apply(console, args);
            };

            // Execute the code
            eval(code);
            
            // Restore original console.log
            console.log = originalLog;

            // Set result and continue workflow
            this.currentResult = output.trim() || 'Code executed successfully (no output)';
            this.displayExecutionResult(this.currentResult);
            this.setStepCompleted(2);
            this.setCardStatus('executionSection', 'highlight');
            this.showLoading(false);
            this.validateCalculation();

        } catch (error) {
            // Restore original console.log in case of error
            console.log = originalLog;
            
            // Check if we should retry
            if (this.executionAttempt < this.maxAttempts) {
                this.setCardStatus('executionSection', 'error');
                this.showError(`JavaScript execution error (attempt ${this.executionAttempt}/${this.maxAttempts}): ${error.message}. Retrying with new code...`);
                
                // Generate new code and try again
                setTimeout(() => this.retryExecutionWithNewCode(), 2000);
            } else {
                this.setCardStatus('executionSection', 'error');
                this.showError(`JavaScript execution failed after ${this.maxAttempts} attempts: ${error.message}`);
                this.showLoading(false);
            }
        }
    }

    async retryExecutionWithNewCode() {
        try {
            this.showLoading(true);
            
            // Add context about the previous error
            const retryContext = this.originalContext + 
                `\n\nPrevious JavaScript code failed with error. Please generate corrected code. Attempt ${this.executionAttempt} of ${this.maxAttempts}.`;
            
            const jsCode = await this.generateJavaScriptCode(this.originalQuestion, retryContext);
            this.currentJSCode = jsCode;
            this.displayCode(jsCode);
            
            // Try executing the new code
            setTimeout(() => this.executeCode(), 500);
            
        } catch (error) {
            this.showError('Error regenerating code for retry: ' + error.message);
            this.showLoading(false);
        }
    }

    displayExecutionResult(output) {
        const outputContainer = document.getElementById('codeOutput');
        outputContainer.textContent = output || 'No output generated';
    }

    async validateCalculation() {
        this.currentAttempt++;
        this.setActiveStep(3);
        this.showLoading(true);
        
        // Show validation workflow
        this.showWorkflowItem('validationWorkflow');
        this.setCardStatus('validationSection', 'processing');
        
        if (this.currentAttempt > 1) {
            document.getElementById('retryInfo').classList.remove('hidden');
            document.getElementById('attemptNumber').textContent = this.currentAttempt;
        }

        try {
            const response = await fetch('/api/validate-calculation', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    question: this.originalQuestion,
                    context: this.originalContext,
                    jsCode: this.currentJSCode,
                    result: this.currentResult
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to validate calculation');
            }

            const validation = await response.json();
            this.displayValidationResult(validation);

            if (validation.isCorrect) {
                this.setStepCompleted(3);
                this.setCardStatus('validationSection', 'highlight');
                // Move to sample question generation
                this.generateSampleQuestion();
            } else if (this.currentAttempt < this.maxAttempts) {
                this.setCardStatus('validationSection', 'error');
                // Retry with regenerated code
                setTimeout(() => this.retryGeneration(), 2000);
            } else {
                this.setStepCompleted(3);
                this.setCardStatus('validationSection', 'error');
                this.showFinalResult(false);
            }

        } catch (error) {
            this.setCardStatus('validationSection', 'error');
            this.showError('Error validating calculation: ' + error.message);
            this.showLoading(false);
        }
    }

    async generateSampleQuestion() {
        this.setActiveStep(4);
        this.showLoading(true);
        this.questionValidationAttempts = 0;
        
        // Show sample workflow
        this.showWorkflowItem('sampleWorkflow');
        this.setCardStatus('sampleQuestionSection', 'processing');

        await this.generateAndValidateQuestion();
    }

    async generateAndValidateQuestion() {
        this.questionValidationAttempts++;
        
        try {
            // Generate a sample question
            const response = await fetch('/api/generate-questions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    originalQuestion: this.originalQuestion,
                    context: this.originalContext + `\n\nGeneration attempt ${this.questionValidationAttempts}.`,
                    jsCode: this.currentJSCode,
                    result: this.currentResult,
                    count: 1
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to generate sample question');
            }

            const data = await response.json();
            const questionText = data.questions;

            // Test if the generated question values work
            const testResponse = await fetch('/api/test-question-values', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    questionText: questionText,
                    context: this.originalContext
                }),
            });

            if (!testResponse.ok) {
                throw new Error('Failed to test question values');
            }

            const testResult = await testResponse.json();

            if (testResult.success) {
                // Question values work - display it
                this.displaySampleQuestion(questionText);
                this.setStepCompleted(4);
                this.setActiveStep(5);
                this.setCardStatus('sampleQuestionSection', 'highlight');
                this.showLoading(false);
            } else {
                // Question values don't work - retry if we haven't hit max attempts
                if (this.questionValidationAttempts < this.maxQuestionValidationAttempts) {
                    console.log(`Question validation failed (attempt ${this.questionValidationAttempts}): ${testResult.error}. Retrying...`);
                    setTimeout(() => this.generateAndValidateQuestion(), 1000);
                } else {
                    this.setCardStatus('sampleQuestionSection', 'error');
                    this.showError(`Failed to generate valid question after ${this.maxQuestionValidationAttempts} attempts. Last error: ${testResult.error}`);
                    this.showLoading(false);
                }
            }

        } catch (error) {
            if (this.questionValidationAttempts < this.maxQuestionValidationAttempts) {
                console.log(`Question generation failed (attempt ${this.questionValidationAttempts}): ${error.message}. Retrying...`);
                setTimeout(() => this.generateAndValidateQuestion(), 1000);
            } else {
                this.setCardStatus('sampleQuestionSection', 'error');
                this.showError(`Error generating sample question after ${this.maxQuestionValidationAttempts} attempts: ${error.message}`);
                this.showLoading(false);
            }
        }
    }

    async regenerateSampleQuestion() {
        this.showLoading(true);
        this.setCardStatus('sampleQuestionSection', 'processing');
        this.questionValidationAttempts = 0;
        
        await this.generateAndValidateQuestion();
    }

    async generateFinalQuestions() {
        this.setStepCompleted(5);
        this.setActiveStep(6);
        this.showLoading(true);
        
        // Show final workflow
        this.showWorkflowItem('finalWorkflow');
        this.setCardStatus('finalQuestionsSection', 'processing');

        // Reset all progress indicators
        this.resetQuestionProgress();

        const questions = [];
        let successCount = 0;

        // Generate 4 questions with detailed progress tracking
        for (let i = 1; i <= 4; i++) {
            try {
                // Activate this question's progress
                this.setQuestionActive(i);
                
                const questionResult = await this.generateAndValidateSingleQuestionWithProgress(i);
                
                if (questionResult.success) {
                    questions.push(questionResult.question);
                    successCount++;
                    this.setQuestionCompleted(i, questionResult.question);
                } else {
                    questions.push(`Question ${i}: Failed to generate - ${questionResult.error}`);
                    this.setQuestionError(i, questionResult.error);
                }
                
                // Add small delay between requests
                if (i < 4) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
            } catch (error) {
                console.error(`Error generating question ${i}:`, error);
                questions.push(`Question ${i}: Error - ${error.message}`);
                this.setQuestionError(i, error.message);
            }
        }

        // Show final results
        this.displayFinalQuestions(questions);
        this.setStepCompleted(6);
        
        if (successCount > 0) {
            this.setCardStatus('finalQuestionsSection', 'highlight');
            document.getElementById('finalQuestions').style.display = 'block';
            document.getElementById('downloadButtons').style.display = 'block';
        } else {
            this.setCardStatus('finalQuestionsSection', 'error');
        }
        
        this.showLoading(false);
    }

    async generateAndValidateSingleQuestionWithProgress(questionNumber) {
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            attempts++;
            
            try {
                // Step 1: Generate question
                this.setProgressStep(questionNumber, 'generate', 'active');
                
                const response = await fetch('/api/generate-single-question', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        originalQuestion: this.originalQuestion,
                        context: this.originalContext,
                        jsCode: this.currentJSCode,
                        result: this.currentResult,
                        questionNumber: questionNumber
                    }),
                });

                if (!response.ok) {
                    throw new Error('Failed to generate question');
                }

                const data = await response.json();
                const questionText = data.question;
                
                this.setProgressStep(questionNumber, 'generate', 'completed');
                
                // Step 2: Generate code for testing
                this.setProgressStep(questionNumber, 'code', 'active');
                await new Promise(resolve => setTimeout(resolve, 500)); // Visual delay
                this.setProgressStep(questionNumber, 'code', 'completed');
                
                // Step 3: Test the question values
                this.setProgressStep(questionNumber, 'test', 'active');
                
                const testResponse = await fetch('/api/test-question-values', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        questionText: questionText,
                        context: this.originalContext
                    }),
                });

                if (!testResponse.ok) {
                    throw new Error('Failed to test question values');
                }

                const testResult = await testResponse.json();

                if (testResult.success) {
                    this.setProgressStep(questionNumber, 'test', 'completed');
                    this.setProgressStep(questionNumber, 'complete', 'completed');
                    
                    return {
                        success: true,
                        question: questionText
                    };
                } else {
                    this.setProgressStep(questionNumber, 'test', 'error');
                    console.log(`Question ${questionNumber} validation failed (attempt ${attempts}): ${testResult.error}`);
                    if (attempts === maxAttempts) {
                        return {
                            success: false,
                            error: `Values validation failed after ${maxAttempts} attempts: ${testResult.error}`
                        };
                    }
                }

            } catch (error) {
                this.setProgressStep(questionNumber, 'generate', 'error');
                console.log(`Question ${questionNumber} generation failed (attempt ${attempts}): ${error.message}`);
                if (attempts === maxAttempts) {
                    return {
                        success: false,
                        error: `Generation failed after ${maxAttempts} attempts: ${error.message}`
                    };
                }
            }

            // Add delay before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Reset progress for retry
            this.resetQuestionProgressSteps(questionNumber);
        }
    }

    // Progress tracking methods
    resetQuestionProgress() {
        for (let i = 1; i <= 4; i++) {
            const progressItem = document.getElementById(`question${i}Progress`);
            progressItem.classList.remove('active', 'completed');
            
            // Reset all steps
            ['generate', 'code', 'test', 'complete'].forEach(step => {
                this.setProgressStep(i, step, 'pending');
            });
            
            // Hide question content
            document.getElementById(`question${i}Content`).style.display = 'none';
        }
    }

    resetQuestionProgressSteps(questionNumber) {
        ['generate', 'code', 'test', 'complete'].forEach(step => {
            this.setProgressStep(questionNumber, step, 'pending');
        });
    }

    setQuestionActive(questionNumber) {
        const progressItem = document.getElementById(`question${questionNumber}Progress`);
        progressItem.classList.add('active');
        progressItem.classList.remove('completed');
    }

    setQuestionCompleted(questionNumber, questionText) {
        const progressItem = document.getElementById(`question${questionNumber}Progress`);
        progressItem.classList.remove('active');
        progressItem.classList.add('completed');
        
        // Show the generated question
        const contentDiv = document.getElementById(`question${questionNumber}Content`);
        contentDiv.textContent = questionText;
        contentDiv.style.display = 'block';
    }

    setQuestionError(questionNumber, errorMessage) {
        const progressItem = document.getElementById(`question${questionNumber}Progress`);
        progressItem.classList.remove('active');
        
        // Show error in content area
        const contentDiv = document.getElementById(`question${questionNumber}Content`);
        contentDiv.textContent = `Error: ${errorMessage}`;
        contentDiv.style.display = 'block';
        contentDiv.style.color = '#dc3545';
    }

    setProgressStep(questionNumber, step, status) {
        const stepElement = document.getElementById(`q${questionNumber}-step-${step}`);
        stepElement.classList.remove('active', 'completed', 'error', 'pending');
        stepElement.classList.add(status);
    }

    displayCode(code) {
        document.getElementById('generatedCode').textContent = code;
        this.showWorkflowItem('codeExecutionWorkflow');
        this.setCardStatus('codeSection', 'highlight');
    }

    displaySampleQuestion(questionText) {
        document.getElementById('sampleQuestion').textContent = questionText;
    }

    displayFinalQuestions(questions) {
        const container = document.getElementById('finalQuestions');
        
        container.innerHTML = '';
        questions.forEach((question, index) => {
            const questionDiv = document.createElement('div');
            questionDiv.className = 'question-item';
            
            const titleDiv = document.createElement('h4');
            titleDiv.textContent = `Question ${index + 1}`;
            
            const contentDiv = document.createElement('div');
            contentDiv.style.whiteSpace = 'pre-wrap';
            contentDiv.style.lineHeight = '1.6';
            contentDiv.textContent = question.trim();
            
            questionDiv.appendChild(titleDiv);
            questionDiv.appendChild(contentDiv);
            container.appendChild(questionDiv);
        });
    }

    displayValidationResult(validation) {
        const container = document.getElementById('validationResult');
        
        container.textContent = validation.feedback;
        container.className = validation.isCorrect ? 'validation-container correct' : 'validation-container incorrect';
    }

    showWorkflowItem(itemId) {
        const item = document.getElementById(itemId);
        if (item && item.classList.contains('hidden')) {
            item.classList.remove('hidden');
            
            // Add animation
            setTimeout(() => {
                item.classList.add('show');
            }, 50);
            
            // Auto-scroll to the new item
            setTimeout(() => {
                item.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'start',
                    inline: 'nearest'
                });
            }, 200);
        }
    }

    setCardStatus(cardId, status) {
        const card = document.getElementById(cardId);
        if (card) {
            // Remove all status classes
            card.classList.remove('highlight', 'processing', 'error');
            
            // Add new status
            if (status) {
                card.classList.add(status);
            }
        }
    }

    setCurrentWorkflow(workflowId) {
        // Remove current class from all workflows
        document.querySelectorAll('.workflow-item').forEach(item => {
            item.classList.remove('current');
        });
        
        // Add current class to specified workflow
        const workflow = document.getElementById(workflowId);
        if (workflow && !workflow.classList.contains('hidden')) {
            workflow.classList.add('current');
        }
    }

    copyAllQuestions() {
        const questionsContainer = document.getElementById('finalQuestions');
        const questionElements = questionsContainer.querySelectorAll('.question-item');
        const questionsText = Array.from(questionElements).map(el => el.textContent.trim()).join('\n\n---\n\n');

        if (questionsText) {
            navigator.clipboard.writeText(questionsText).then(() => {
                // Show temporary success message
                const btn = document.getElementById('copyAllBtn');
                const originalText = btn.textContent;
                btn.textContent = '✅ Copied!';
                btn.style.background = '#28a745';
                
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.style.background = '';
                }, 2000);
            }).catch(err => {
                this.showError('Failed to copy to clipboard: ' + err.message);
            });
        }
    }

    startOver() {
        // Clear form inputs
        document.getElementById('question').value = '';
        document.getElementById('context').value = '';
        
        // Reset all state
        this.currentAttempt = 0;
        this.executionAttempt = 0;
        this.questionValidationAttempts = 0;
        this.currentJSCode = '';
        this.currentResult = '';
        this.originalQuestion = '';
        this.originalContext = '';
        this.currentEditingContextId = null;
        
        // Reset UI
        this.resetUI();
        
        // Hide final questions and download buttons
        document.getElementById('finalQuestions').style.display = 'none';
        document.getElementById('downloadButtons').style.display = 'none';
        
        // Reset question progress
        this.resetQuestionProgress();
        
        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async retryGeneration() {
        const context = this.originalContext + 
            '\n\nPrevious attempt was incorrect. Please fix the calculation.';

        try {
            this.showLoading(true);
            this.executionAttempt = 0;
            const jsCode = await this.generateJavaScriptCode(this.originalQuestion, context);
            this.currentJSCode = jsCode;
            this.displayCode(jsCode);
            
            // Auto-execute the new code
            setTimeout(() => this.executeCode(), 500);
            
        } catch (error) {
            this.showError('Error regenerating code: ' + error.message);
            this.showLoading(false);
        }
    }

    showFinalResult(success) {
        this.showLoading(false);
        this.showWorkflowItem('finalResultWorkflow');

        const finalOutput = document.getElementById('finalOutput');

        if (success) {
            finalOutput.innerHTML = `
                <h4>✅ Calculation Successfully Validated!</h4>
                <p>The JavaScript calculation is mathematically correct and ready to use.</p>
                <p><strong>Validation completed on attempt ${this.currentAttempt} of ${this.maxAttempts}</strong></p>
            `;
            finalOutput.className = 'final-output';
            this.setCardStatus('finalResult', 'highlight');
        } else {
            finalOutput.innerHTML = `
                <h4>❌ Maximum Attempts Reached</h4>
                <p>After ${this.maxAttempts} attempts, the calculation could not be validated as correct.</p>
                <p>Please review the question and try again with more specific requirements.</p>
            `;
            finalOutput.className = 'final-output';
            finalOutput.style.background = 'linear-gradient(135deg, #e53e3e 0%, #c53030 100%)';
            this.setCardStatus('finalResult', 'error');
        }
    }

    setActiveStep(stepNumber) {
        // Remove active class from all steps
        document.querySelectorAll('.step').forEach(step => {
            step.classList.remove('active');
        });
        
        // Add active class to current step
        if (stepNumber <= 6) {
            document.getElementById(`step${stepNumber}`).classList.add('active');
        }
    }

    setStepCompleted(stepNumber) {
        const step = document.getElementById(`step${stepNumber}`);
        step.classList.remove('active');
        step.classList.add('completed');
    }

    showLoading(show) {
        const loadingIndicator = document.getElementById('loadingIndicator');
        if (show) {
            loadingIndicator.classList.remove('hidden');
        } else {
            loadingIndicator.classList.add('hidden');
        }
    }

    // Simplified error/success messaging
    showError(message) {
        alert('Error: ' + message);
        this.showLoading(false);
    }
    
    showSuccess(message) {
        alert('Success: ' + message);
    }

    resetUI() {
        // Hide all workflow items
        document.querySelectorAll('.workflow-item').forEach(item => {
            item.classList.add('hidden');
            item.classList.remove('show', 'current');
        });

        // Reset all steps
        document.querySelectorAll('.step').forEach(step => {
            step.classList.remove('active', 'completed');
        });

        // Reset all card statuses
        document.querySelectorAll('.result-card').forEach(card => {
            card.classList.remove('highlight', 'processing', 'error');
        });

        // Remove any error messages
        const existingError = document.querySelector('.error');
        if (existingError) {
            existingError.remove();
        }

        // Hide retry info
        document.getElementById('retryInfo').classList.add('hidden');
    }

    // Context management functionality
    showContextModal() {
        this.loadContexts();
        document.getElementById('contextModal').style.display = 'block';
    }
    
    showSaveContextModal() {
        document.getElementById('saveContextModal').style.display = 'block';
        // Pre-fill form if editing
        if (this.currentEditingContextId) {
            this.loadContextForEditing(this.currentEditingContextId);
        }
    }
    
    closeModal(e) {
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => modal.style.display = 'none');
        this.currentEditingContextId = null;
        // Reset form
        document.getElementById('saveContextForm').reset();
    }
    
    async loadContexts() {
        try {
            const response = await fetch('/api/contexts');
            const data = await response.json();
            this.displayContexts(data.contexts);
        } catch (error) {
            console.error('Error loading contexts:', error);
            this.showError('Failed to load saved contexts');
        }
    }
    
    displayContexts(contexts) {
        const container = document.querySelector('#contextModal .context-list');
        
        if (contexts.length === 0) {
            container.innerHTML = '<p>No saved contexts found.</p>';
            return;
        }
        
        container.innerHTML = contexts.map(context => `
            <div class="context-item" data-id="${context._id}">
                <h4>${context.name}</h4>
                <p><strong>Description:</strong> ${context.description || 'No description'}</p>
                <p><strong>Created:</strong> ${new Date(context.createdAt).toLocaleDateString()}</p>
                <div class="context-meta">
                    <div class="context-tags">
                        ${context.tags.map(tag => `<span class="context-tag">${tag}</span>`).join('')}
                    </div>
                    <div class="context-actions">
                        <button class="btn-edit" onclick="validator.loadContext('${context._id}')">Load</button>
                        <button class="btn-edit" onclick="validator.editContext('${context._id}')">Edit</button>
                        <button class="btn-delete" onclick="validator.deleteContext('${context._id}')">Delete</button>
                    </div>
                </div>
            </div>
        `).join('');
    }
    
    async loadContext(contextId) {
        try {
            const response = await fetch(`/api/contexts/${contextId}`);
            const data = await response.json();
            
            if (data.context) {
                document.getElementById('question').value = data.context.question;
                document.getElementById('context').value = data.context.context;
                this.closeModal();
                this.showSuccess('Context loaded successfully!');
            }
        } catch (error) {
            console.error('Error loading context:', error);
            this.showError('Failed to load context');
        }
    }
    
    editContext(contextId) {
        this.currentEditingContextId = contextId;
        this.closeModal();
        this.showSaveContextModal();
    }
    
    async loadContextForEditing(contextId) {
        try {
            const response = await fetch(`/api/contexts/${contextId}`);
            const data = await response.json();
            
            if (data.context) {
                document.getElementById('contextName').value = data.context.name;
                document.getElementById('contextDescription').value = data.context.description || '';
                document.getElementById('contextTags').value = data.context.tags.join(', ');
            }
        } catch (error) {
            console.error('Error loading context for editing:', error);
        }
    }
    
    async deleteContext(contextId) {
        if (!confirm('Are you sure you want to delete this context?')) return;
        
        try {
            const response = await fetch(`/api/contexts/${contextId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                this.showSuccess('Context deleted successfully!');
                this.loadContexts(); // Refresh the list
            } else {
                throw new Error('Failed to delete context');
            }
        } catch (error) {
            console.error('Error deleting context:', error);
            this.showError('Failed to delete context');
        }
    }
    
    async saveContext(e) {
        e.preventDefault();
        
        const name = document.getElementById('contextName').value.trim();
        const description = document.getElementById('contextDescription').value.trim();
        const tags = document.getElementById('contextTags').value
            .split(',')
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0);
        
        const question = document.getElementById('question').value.trim();
        const context = document.getElementById('context').value.trim();
        
        if (!name || !question) {
            this.showError('Name and question are required');
            return;
        }
        
        const saveBtn = document.querySelector('#saveContextForm button[type="submit"]');
        saveBtn.classList.add('loading');
        
        try {
            const method = this.currentEditingContextId ? 'PUT' : 'POST';
            const url = this.currentEditingContextId 
                ? `/api/contexts/${this.currentEditingContextId}`
                : '/api/save-context';
            
            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, question, context, tags, description })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.showSuccess(this.currentEditingContextId ? 'Context updated successfully!' : 'Context saved successfully!');
                this.closeModal();
            } else {
                this.showError(data.error || 'Failed to save context');
            }
        } catch (error) {
            console.error('Error saving context:', error);
            this.showError('Failed to save context');
        } finally {
            saveBtn.classList.remove('loading');
        }
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const validator = new CalculationValidator();
    // Make validator globally accessible for onclick handlers in context management
    window.validator = validator;
}); 