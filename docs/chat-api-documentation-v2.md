# Chat API Documentation v2.0 - Improved Versioning System

## Overview

API chat dengan sistem versioning yang telah diperbaiki untuk mendukung:
- Edit message dengan auto-completion streaming
- Lazy loading untuk performa optimal
- Version management yang efisien
- Branching conversation yang jelas

## Base URL
```
/api/chat
```

## Authentication
Semua endpoint memerlukan Bearer token:
```
Authorization: Bearer <your-jwt-token>
```

---

## 1. Chat History dengan Lazy Loading

### Get Conversation Chats (Optimized)
Mendapatkan history chat dengan lazy loading dan performa optimal.

**Endpoint:** `GET /conversation/:conversationId`

**Query Parameters:**
- `limit` (number, optional): Jumlah pesan (default: 20, max: 100)
- `lastEvaluatedKey` (string, optional): Base64 encoded key untuk pagination
- `sortOrder` (string, optional): 'asc' atau 'desc' (default: 'desc')
- `includeVersions` (boolean, optional): Include version metadata (default: false)

**Response:**
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "chatId": "chat-uuid",
        "conversationId": "conv-uuid",
        "userId": "user-uuid",
        "role": "user|assistant",
        "content": "Message content",
        "messageIndex": 0,
        "isActive": true,
        "versionNumber": 1,
        "isCurrentVersion": true,
        "canEdit": true,
        "createdAt": "2024-01-01T00:00:00Z",
        "updatedAt": "2024-01-01T00:00:00Z"
      }
    ],
    "lastEvaluatedKey": "base64-encoded-key",
    "hasMore": true,
    "limit": 20,
    "totalResults": 100,
    "conversationInfo": {
      "conversationId": "conv-uuid",
      "totalMessages": 100,
      "activeMessages": 95
    }
  }
}
```

**Frontend Usage:**
```javascript
// Initial load
const response = await fetch(`/api/chat/conversation/${conversationId}?limit=20&sortOrder=desc`);

// Load more (pagination)
const moreResponse = await fetch(
  `/api/chat/conversation/${conversationId}?limit=20&lastEvaluatedKey=${encodedKey}`
);
```

---

## 2. Edit Message dengan Auto-Completion (RECOMMENDED)

### Edit User Message and Auto-Complete
Edit pesan user dan langsung generate response baru dengan streaming.

**Endpoint:** `PUT /:chatId/edit-and-complete`

**Request Body:**
```json
{
  "content": "Updated message content",
  "model": "gpt-4",
  "autoComplete": true
}
```

**Response:** Server-Sent Events stream dengan multiple event types

**Stream Events:**

1. **Edit Complete Event:**
```
event: edit-complete
data: {
  "editedMessage": {
    "chatId": "new-chat-uuid",
    "content": "Updated content",
    "versionNumber": 2,
    "isCurrentVersion": true,
    "hasMultipleVersions": true,
    "totalVersions": 2
  },
  "branchInfo": {
    "branchCreated": true,
    "deactivatedMessagesCount": 3,
    "message": "Message edited. Subsequent messages deactivated."
  }
}
```

2. **Completion Start Event:**
```
event: completion-start
data: {
  "message": "Starting AI response generation..."
}
```

3. **Completion Data Events:**
```
event: completion-data
data: {
  "choices": [
    {
      "delta": {
        "content": "Streaming response content..."
      }
    }
  ]
}
```

4. **Completion Complete Event:**
```
event: completion-complete
data: {
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  },
  "cost": {
    "usd": 0.001,
    "idr": 15.5
  },
  "assistantMessage": {
    "chatId": "assistant-chat-uuid",
    "content": "Complete response",
    "versionNumber": 1,
    "isCurrentVersion": true
  }
}
```

5. **Done Event:**
```
event: done
data: [DONE]
```

6. **Error Event:**
```
event: error
data: {
  "error": "Insufficient balance for completion",
  "required": 15.5,
  "current": 10.0
}
```

**Frontend Implementation:**
```javascript
async function editMessageAndComplete(chatId, newContent, model) {
  const response = await fetch(`/api/chat/${chatId}/edit-and-complete`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      content: newContent,
      model: model,
      autoComplete: true
    })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        const eventType = line.slice(7);
        // Handle different event types
      }
      
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;
        
        const parsed = JSON.parse(data);
        
        // Handle based on event type
        if (parsed.editedMessage) {
          handleEditComplete(parsed);
        } else if (parsed.choices?.[0]?.delta?.content) {
          handleStreamingContent(parsed.choices[0].delta.content);
        } else if (parsed.assistantMessage) {
          handleCompletionComplete(parsed);
        }
      }
    }
  }
}
```

---

## 3. Version Management

### Get Chat Versions (Paginated)
Mendapatkan semua versi dari chat tertentu dengan pagination.

**Endpoint:** `GET /:chatId/versions`

**Query Parameters:**
- `limit` (number, optional): Jumlah versi per halaman (default: 10, max: 50)
- `page` (number, optional): Nomor halaman (default: 1)

**Response:**
```json
{
  "success": true,
  "data": {
    "versions": [
      {
        "chatId": "version-chat-uuid",
        "versionId": "version-uuid",
        "versionNumber": 1,
        "isCurrentVersion": false,
        "content": "Version 1 content",
        "contentPreview": "Version 1 content preview...",
        "wordCount": 25,
        "characterCount": 150,
        "createdAt": "2024-01-01T00:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 5,
      "totalPages": 1,
      "hasMore": false
    }
  }
}
```

### Switch to Version
Beralih ke versi tertentu dari chat.

**Endpoint:** `POST /:chatId/switch-version`

**Request Body:**
```json
{
  "versionNumber": 2
}
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully switched to version",
  "data": {
    "switchedToVersion": {
      "chatId": "chat-uuid",
      "content": "Version content",
      "versionNumber": 2,
      "isCurrentVersion": true,
      "hasMultipleVersions": true,
      "totalVersions": 3
    },
    "conversationThread": [
      // Updated conversation messages
    ],
    "switchInfo": {
      "message": "Successfully switched to version 2",
      "affectedMessages": 10
    }
  }
}
```

---

## 4. Alternative Endpoints

### Edit Message Only (No Auto-Completion)
Untuk edit tanpa auto-completion.

**Endpoint:** `PUT /:chatId/edit`

**Request Body:**
```json
{
  "content": "Updated message content"
}
```

### Generate Response Separately
Generate response untuk user message yang sudah ada.

**Endpoint:** `POST /:chatId/generate`

**Request Body:**
```json
{
  "model": "gpt-4"
}
```

**Response:** Server-Sent Events stream (sama seperti completion-data events di atas)

---

## 5. Error Handling

### Common Error Responses

**400 Bad Request:**
```json
{
  "success": false,
  "code": 400,
  "message": "Content is required and cannot be empty"
}
```

**402 Payment Required:**
```json
{
  "success": false,
  "code": 402,
  "message": "Insufficient balance for this operation",
  "required": 15.5,
  "current": 10.0
}
```

**404 Not Found:**
```json
{
  "success": false,
  "code": 404,
  "message": "Chat not found"
}
```

**Stream Errors:**
```json
{
  "error": "Balance depleted during streaming. Response truncated."
}
```

---

## 6. Frontend Integration Examples

### Complete Chat App Integration

```javascript
class ChatVersioningApp {
  constructor() {
    this.messages = [];
    this.lastEvaluatedKey = null;
    this.hasMore = true;
  }

  // Load chat history dengan lazy loading
  async loadChatHistory(conversationId, loadMore = false) {
    const params = new URLSearchParams({
      limit: '20',
      sortOrder: 'desc'
    });

    if (loadMore && this.lastEvaluatedKey) {
      params.append('lastEvaluatedKey', this.lastEvaluatedKey);
    }

    const response = await fetch(
      `/api/chat/conversation/${conversationId}?${params}`,
      {
        headers: { 'Authorization': `Bearer ${this.token}` }
      }
    );

    const result = await response.json();
    
    if (result.success) {
      const newMessages = result.data.results.reverse();
      
      if (loadMore) {
        this.messages = [...newMessages, ...this.messages];
      } else {
        this.messages = newMessages;
      }

      this.lastEvaluatedKey = result.data.lastEvaluatedKey;
      this.hasMore = result.data.hasMore;
      
      this.renderMessages();
    }
  }

  // Edit message dengan auto-completion
  async editMessage(chatId, newContent, model) {
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

    return this.handleStreamingResponse(response);
  }

  async handleStreamingResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    let currentEvent = null;
    let editResult = null;
    let streamingContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7);
          continue;
        }
        
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            
            switch (currentEvent) {
              case 'edit-complete':
                editResult = parsed;
                this.handleEditComplete(parsed);
                break;
                
              case 'completion-start':
                this.handleCompletionStart();
                break;
                
              case 'completion-data':
                if (parsed.choices?.[0]?.delta?.content) {
                  const content = parsed.choices[0].delta.content;
                  streamingContent += content;
                  this.handleStreamingContent(content);
                }
                break;
                
              case 'completion-complete':
                this.handleCompletionComplete(parsed);
                break;
                
              case 'error':
                this.handleError(parsed);
                break;
            }
          } catch (error) {
            console.error('Parse error:', error);
          }
        }
      }
    }
  }

  handleEditComplete(data) {
    // Update message in UI
    const messageIndex = this.messages.findIndex(m => 
      m.originalChatId === data.editedMessage.originalChatId
    );
    
    if (messageIndex !== -1) {
      this.messages[messageIndex] = data.editedMessage;
      this.renderMessages();
    }

    // Show branching notification
    if (data.branchInfo?.deactivatedMessagesCount > 0) {
      this.showBranchingNotification(data.branchInfo);
    }
  }

  handleStreamingContent(content) {
    // Update streaming assistant message
    this.updateStreamingMessage(content);
  }

  handleCompletionComplete(data) {
    // Add final assistant message
    this.messages.push(data.assistantMessage);
    this.renderMessages();
    
    // Update user balance
    this.updateBalance(data.cost.idr);
  }

  // Version management
  async showVersions(chatId) {
    const response = await fetch(`/api/chat/${chatId}/versions?limit=10&page=1`, {
      headers: { 'Authorization': `Bearer ${this.token}` }
    });

    const result = await response.json();
    
    if (result.success) {
      this.renderVersionModal(result.data.versions, result.data.pagination, chatId);
    }
  }

  async switchToVersion(chatId, versionNumber) {
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
      // Update message with new version
      const messageIndex = this.messages.findIndex(m => 
        m.originalChatId === result.data.switchedToVersion.originalChatId
      );
      
      if (messageIndex !== -1) {
        this.messages[messageIndex] = result.data.switchedToVersion;
        this.renderMessages();
      }
    }
  }

  // UI Helper methods
  renderMessages() {
    // Render messages to UI
  }

  showBranchingNotification(branchInfo) {
    // Show notification about conversation branching
  }

  updateStreamingMessage(content) {
    // Update streaming message in real-time
  }

  updateBalance(cost) {
    // Update user balance display
  }

  renderVersionModal(versions, pagination, chatId) {
    // Render version selection modal
  }
}
```

---

## 7. Best Practices

### Performance
1. **Lazy Loading**: Selalu gunakan pagination untuk chat history
2. **Minimal Version Info**: Set `includeVersions=false` untuk performa optimal
3. **Efficient Caching**: Cache conversation data di frontend
4. **Debounce Edits**: Debounce edit operations untuk menghindari spam

### Error Handling
1. **Stream Interruption**: Handle stream errors gracefully
2. **Balance Checks**: Check balance sebelum operations
3. **Network Errors**: Implement retry mechanisms
4. **Validation**: Validate inputs di frontend

### User Experience
1. **Loading States**: Show progress indicators
2. **Optimistic Updates**: Update UI immediately
3. **Clear Feedback**: Show edit/version status clearly
4. **Keyboard Shortcuts**: Implement common shortcuts

### Security
1. **Token Management**: Handle token expiration
2. **Input Sanitization**: Sanitize all user inputs
3. **Rate Limiting**: Respect API rate limits
4. **CORS**: Ensure proper CORS setup

Dengan dokumentasi ini, frontend developer dapat mengimplementasikan sistem versioning yang robust dengan performa optimal dan user experience yang baik.