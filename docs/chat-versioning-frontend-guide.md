# Chat Versioning Frontend Implementation Guide

## Overview

Sistem versioning chat memungkinkan pengguna untuk:
- Edit pesan user dan langsung mendapat response baru
- Melihat dan beralih antar versi pesan
- Lazy loading untuk performa optimal
- Mengelola percakapan dengan branching

## 1. Edit Message dengan Auto-Completion

### Endpoint Utama (Recommended)
```
PUT /api/chat/:chatId/edit-and-complete
```

### Request Body
```javascript
{
  "content": "Updated message content",
  "model": "gpt-4",
  "autoComplete": true  // default: true
}
```

### Frontend Implementation

```javascript
class ChatVersioningManager {
  constructor() {
    this.eventSource = null;
  }

  // Edit message dan auto-complete dengan streaming
  async editMessageAndComplete(chatId, newContent, model) {
    try {
      const response = await fetch(`/api/chat/${chatId}/edit-and-complete`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({
          content: newContent,
          model: model,
          autoComplete: true
        })
      });

      if (!response.ok) {
        throw new Error('Failed to edit message');
      }

      // Handle streaming response
      return this.handleStreamingResponse(response);
    } catch (error) {
      console.error('Edit and complete error:', error);
      throw error;
    }
  }

  // Handle streaming response dengan multiple events
  async handleStreamingResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    let editResult = null;
    let assistantMessage = null;
    let streamingContent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            const eventType = line.slice(7);
            continue;
          }
          
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
            if (data === '[DONE]') {
              this.onStreamComplete(editResult, assistantMessage, streamingContent);
              return { editResult, assistantMessage, content: streamingContent };
            }

            try {
              const parsed = JSON.parse(data);
              
              // Handle different event types
              if (parsed.editedMessage) {
                // Edit completed
                editResult = parsed;
                this.onEditComplete(parsed);
              } else if (parsed.choices?.[0]?.delta?.content) {
                // Streaming content
                const content = parsed.choices[0].delta.content;
                streamingContent += content;
                this.onStreamingContent(content);
              } else if (parsed.assistantMessage) {
                // Completion finished
                assistantMessage = parsed.assistantMessage;
                this.onCompletionComplete(parsed);
              } else if (parsed.error) {
                // Error occurred
                this.onError(parsed.error);
                throw new Error(parsed.error);
              }
            } catch (parseError) {
              console.error('Parse error:', parseError);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // Callback methods untuk UI updates
  onEditComplete(editResult) {
    console.log('Edit completed:', editResult);
    // Update UI untuk menunjukkan pesan telah diedit
    this.updateMessageInUI(editResult.editedMessage);
    
    // Show branching info jika ada
    if (editResult.branchInfo?.deactivatedMessagesCount > 0) {
      this.showBranchingNotification(editResult.branchInfo);
    }
  }

  onStreamingContent(content) {
    // Update UI dengan streaming content
    this.appendToAssistantMessage(content);
  }

  onCompletionComplete(result) {
    console.log('Completion finished:', result);
    // Finalize assistant message
    this.finalizeAssistantMessage(result.assistantMessage);
    
    // Update balance if provided
    if (result.cost) {
      this.updateUserBalance(result.cost.idr);
    }
  }

  onStreamComplete(editResult, assistantMessage, content) {
    console.log('Stream completed');
    // Final cleanup and UI updates
  }

  onError(error) {
    console.error('Stream error:', error);
    // Show error to user
    this.showErrorMessage(error);
  }
}
```

## 2. Lazy Loading Chat History

### Endpoint
```
GET /api/chat/conversation/:conversationId
```

### Query Parameters
```javascript
{
  limit: 20,                    // default: 20, max: 100
  lastEvaluatedKey: "base64...", // untuk pagination
  sortOrder: "desc",            // "asc" atau "desc"
  includeVersions: false        // default: false untuk performa
}
```

### Frontend Implementation

```javascript
class ChatHistoryManager {
  constructor() {
    this.messages = [];
    this.lastEvaluatedKey = null;
    this.hasMore = true;
    this.loading = false;
  }

  // Load initial chat history
  async loadChatHistory(conversationId, limit = 20) {
    if (this.loading) return;
    
    this.loading = true;
    
    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        sortOrder: 'desc',
        includeVersions: 'false' // Untuk performa optimal
      });

      if (this.lastEvaluatedKey) {
        params.append('lastEvaluatedKey', this.lastEvaluatedKey);
      }

      const response = await fetch(
        `/api/chat/conversation/${conversationId}?${params}`,
        {
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        }
      );

      if (!response.ok) {
        throw new Error('Failed to load chat history');
      }

      const result = await response.json();
      
      if (result.success) {
        // Append new messages (reverse karena sortOrder desc)
        const newMessages = result.data.results.reverse();
        
        if (this.lastEvaluatedKey) {
          // Loading more - prepend to existing messages
          this.messages = [...newMessages, ...this.messages];
        } else {
          // Initial load
          this.messages = newMessages;
        }

        this.lastEvaluatedKey = result.data.lastEvaluatedKey;
        this.hasMore = result.data.hasMore;
        
        // Update UI
        this.renderMessages();
        
        return {
          messages: newMessages,
          hasMore: this.hasMore,
          totalResults: result.data.totalResults
        };
      }
    } catch (error) {
      console.error('Error loading chat history:', error);
      throw error;
    } finally {
      this.loading = false;
    }
  }

  // Load more messages (untuk infinite scroll)
  async loadMoreMessages(conversationId) {
    if (!this.hasMore || this.loading) return;
    
    return this.loadChatHistory(conversationId);
  }

  // Infinite scroll implementation
  setupInfiniteScroll(conversationId) {
    const chatContainer = document.getElementById('chat-container');
    
    chatContainer.addEventListener('scroll', () => {
      // Check if scrolled to top (untuk load older messages)
      if (chatContainer.scrollTop === 0 && this.hasMore && !this.loading) {
        this.loadMoreMessages(conversationId);
      }
    });
  }

  renderMessages() {
    // Render messages to UI
    const container = document.getElementById('messages-container');
    container.innerHTML = '';
    
    this.messages.forEach(message => {
      const messageElement = this.createMessageElement(message);
      container.appendChild(messageElement);
    });
  }

  createMessageElement(message) {
    const div = document.createElement('div');
    div.className = `message ${message.role}`;
    div.innerHTML = `
      <div class="message-content">${message.content}</div>
      <div class="message-actions">
        ${message.canEdit ? `<button onclick="editMessage('${message.chatId}')">Edit</button>` : ''}
        <button onclick="showVersions('${message.chatId}')">Versions</button>
      </div>
    `;
    return div;
  }
}
```

## 3. Version Management

### Get Versions (Lazy Loading)
```
GET /api/chat/:chatId/versions?limit=10&page=1
```

### Switch Version
```
POST /api/chat/:chatId/switch-version
Body: { "versionNumber": 2 }
```

### Frontend Implementation

```javascript
class VersionManager {
  // Load versions dengan pagination
  async loadVersions(chatId, page = 1, limit = 10) {
    try {
      const response = await fetch(
        `/api/chat/${chatId}/versions?page=${page}&limit=${limit}`,
        {
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        }
      );

      const result = await response.json();
      
      if (result.success) {
        return {
          versions: result.data.versions,
          pagination: result.data.pagination
        };
      }
    } catch (error) {
      console.error('Error loading versions:', error);
      throw error;
    }
  }

  // Switch ke versi tertentu
  async switchToVersion(chatId, versionNumber) {
    try {
      const response = await fetch(`/api/chat/${chatId}/switch-version`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({ versionNumber })
      });

      const result = await response.json();
      
      if (result.success) {
        // Update UI dengan versi yang dipilih
        this.updateMessageVersion(result.data.switchedToVersion);
        
        // Update conversation thread jika diperlukan
        if (result.data.conversationThread) {
          this.updateConversationThread(result.data.conversationThread);
        }
        
        return result.data;
      }
    } catch (error) {
      console.error('Error switching version:', error);
      throw error;
    }
  }

  // Show version selector UI
  showVersionSelector(chatId) {
    this.loadVersions(chatId).then(({ versions, pagination }) => {
      this.renderVersionSelector(versions, pagination, chatId);
    });
  }

  renderVersionSelector(versions, pagination, chatId) {
    const modal = document.createElement('div');
    modal.className = 'version-modal';
    modal.innerHTML = `
      <div class="version-modal-content">
        <h3>Message Versions</h3>
        <div class="versions-list">
          ${versions.map(version => `
            <div class="version-item ${version.isCurrentVersion ? 'current' : ''}" 
                 onclick="switchToVersion('${chatId}', ${version.versionNumber})">
              <div class="version-header">
                <span class="version-number">Version ${version.versionNumber}</span>
                <span class="version-date">${new Date(version.createdAt).toLocaleString()}</span>
                ${version.isCurrentVersion ? '<span class="current-badge">Current</span>' : ''}
              </div>
              <div class="version-preview">${version.contentPreview}</div>
            </div>
          `).join('')}
        </div>
        ${pagination.hasMore ? `
          <button onclick="loadMoreVersions('${chatId}', ${pagination.page + 1})">
            Load More Versions
          </button>
        ` : ''}
        <button onclick="closeVersionModal()">Close</button>
      </div>
    `;
    
    document.body.appendChild(modal);
  }
}
```

## 4. Complete Integration Example

```javascript
class ChatApp {
  constructor() {
    this.versioningManager = new ChatVersioningManager();
    this.historyManager = new ChatHistoryManager();
    this.versionManager = new VersionManager();
    this.currentConversationId = null;
  }

  // Initialize chat untuk conversation tertentu
  async initializeChat(conversationId) {
    this.currentConversationId = conversationId;
    
    // Load initial chat history
    await this.historyManager.loadChatHistory(conversationId);
    
    // Setup infinite scroll
    this.historyManager.setupInfiniteScroll(conversationId);
  }

  // Edit message dengan auto-completion
  async editMessage(chatId, newContent, model) {
    try {
      // Show loading state
      this.showEditingState(chatId);
      
      // Edit dan auto-complete
      const result = await this.versioningManager.editMessageAndComplete(
        chatId, 
        newContent, 
        model
      );
      
      // Update local message list
      this.updateLocalMessage(result.editResult.editedMessage);
      
      // Add new assistant message jika ada
      if (result.assistantMessage) {
        this.addLocalMessage(result.assistantMessage);
      }
      
    } catch (error) {
      this.showError('Failed to edit message: ' + error.message);
    }
  }

  // Show versions untuk message tertentu
  async showMessageVersions(chatId) {
    this.versionManager.showVersionSelector(chatId);
  }

  // Switch ke versi tertentu
  async switchMessageVersion(chatId, versionNumber) {
    try {
      const result = await this.versionManager.switchToVersion(chatId, versionNumber);
      
      // Update UI dengan versi baru
      this.updateLocalMessage(result.switchedToVersion);
      
      // Close version modal
      this.closeVersionModal();
      
    } catch (error) {
      this.showError('Failed to switch version: ' + error.message);
    }
  }

  // Helper methods
  updateLocalMessage(message) {
    const index = this.historyManager.messages.findIndex(m => 
      m.originalChatId === message.originalChatId || m.chatId === message.chatId
    );
    
    if (index !== -1) {
      this.historyManager.messages[index] = message;
      this.historyManager.renderMessages();
    }
  }

  addLocalMessage(message) {
    this.historyManager.messages.push(message);
    this.historyManager.renderMessages();
  }

  showEditingState(chatId) {
    // Show loading spinner atau state
  }

  showError(message) {
    // Show error notification
  }

  closeVersionModal() {
    const modal = document.querySelector('.version-modal');
    if (modal) modal.remove();
  }
}

// Usage
const chatApp = new ChatApp();

// Initialize untuk conversation tertentu
chatApp.initializeChat('conversation-id-123');

// Edit message
chatApp.editMessage('chat-id-456', 'Updated content', 'gpt-4');

// Show versions
chatApp.showMessageVersions('chat-id-456');
```

## 5. Best Practices

### Performance Optimization
1. **Lazy Loading**: Selalu gunakan pagination untuk chat history
2. **Version Loading**: Load versions hanya ketika diperlukan
3. **Caching**: Cache conversation data di frontend
4. **Debouncing**: Debounce edit operations

### Error Handling
1. **Network Errors**: Implement retry mechanism
2. **Balance Errors**: Show topup prompts
3. **Validation Errors**: Show clear error messages
4. **Stream Interruption**: Handle gracefully

### User Experience
1. **Loading States**: Show progress indicators
2. **Optimistic Updates**: Update UI immediately, rollback on error
3. **Keyboard Shortcuts**: Implement common shortcuts
4. **Auto-save**: Save drafts automatically

### Security
1. **Token Management**: Handle token expiration
2. **Input Validation**: Validate all user inputs
3. **Rate Limiting**: Respect API rate limits
4. **CORS**: Ensure proper CORS configuration

## 6. Event Types untuk Streaming

### Edit and Complete Stream Events
```javascript
// Event types yang akan diterima:
'edit-complete'      // Edit selesai
'completion-start'   // Mulai generate response
'completion-data'    // Streaming response data
'completion-complete' // Response generation selesai
'error'             // Error occurred
'done'              // Stream selesai
```

### Error Handling untuk Stream
```javascript
// Handle berbagai jenis error:
{
  "error": "Insufficient balance for completion",
  "required": 15.5,
  "current": 10.0
}

{
  "error": "Invalid model selected"
}

{
  "error": "Balance depleted during streaming. Response truncated."
}
```

Dengan implementasi ini, frontend akan memiliki sistem versioning yang robust dengan performa optimal dan UX yang baik.