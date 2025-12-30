// comm.js

import { db, auth } from './firebase-init.js';
import { 
    collection, 
    addDoc, 
    query, 
    orderBy, 
    limitToLast,
    onSnapshot, 
    serverTimestamp,
    getDocs,
    endBefore
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const messageContainer = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const scrollToBottomBtn = document.createElement('button'); // Scroll button

// Setup Scroll to Bottom Button
scrollToBottomBtn.innerHTML = "↓ New Messages";
scrollToBottomBtn.id = "scroll-btn";
scrollToBottomBtn.style.display = "none";
document.body.appendChild(scrollToBottomBtn);

let oldestDoc = null; 
let isLoadingMore = false;
let hasMoreMessages = true; // Prevents repeating at the end of history

// 1. LISTEN FOR LIVE MESSAGES (Newest 50)
const messagesCol = collection(db, "messages");
const q = query(messagesCol, orderBy("createdAt", "asc"), limitToLast(50));

onSnapshot(q, (snapshot) => {
    // Only set the initial oldestDoc once
    if (!oldestDoc && !snapshot.empty) {
        oldestDoc = snapshot.docs[0];
    }
    
    if (!isLoadingMore) {
        const isAtBottom = messageContainer.scrollHeight - messageContainer.scrollTop <= messageContainer.clientHeight + 100;
        
        messageContainer.innerHTML = ''; 
        snapshot.forEach((doc) => {
            renderMessage(doc.data(), false);
        });

        if (isAtBottom) {
            messageContainer.scrollTop = messageContainer.scrollHeight;
        }
    }
});

// 2. INFINITE SCROLL: LOAD OLDER MESSAGES
messageContainer.addEventListener('scroll', async () => {
    // Show/Hide "Scroll to Bottom" button
    const isScrolledUp = messageContainer.scrollHeight - messageContainer.scrollTop > messageContainer.clientHeight + 500;
    scrollToBottomBtn.style.display = isScrolledUp ? "block" : "none";

    // Load older messages if at the top
    if (messageContainer.scrollTop === 0 && oldestDoc && !isLoadingMore && hasMoreMessages) {
        isLoadingMore = true;
        const oldHeight = messageContainer.scrollHeight;

        const olderQuery = query(
            messagesCol, 
            orderBy("createdAt", "asc"), 
            endBefore(oldestDoc), 
            limitToLast(50)
        );

        const snapshot = await getDocs(olderQuery);
        
        if (!snapshot.empty) {
            // Update oldestDoc to the first doc of the new batch
            oldestDoc = snapshot.docs[0];
            
            // Render them at the top in reverse order to keep sequence correct
            snapshot.docs.reverse().forEach(doc => {
                renderMessage(doc.data(), true);
            });
            
            messageContainer.scrollTop = messageContainer.scrollHeight - oldHeight;
        } else {
            hasMoreMessages = false; // No more older messages to fetch
        }
        
        isLoadingMore = false;
    }
});

// 3. SEND A NEW MESSAGE
chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    const text = chatInput.value.trim();
    if (text === "" || !user) return;

    try {
        await addDoc(messagesCol, {
            text: text,
            uid: user.uid,
            displayName: user.displayName || user.email.split('@')[0] || "Gamer", 
            photoURL: user.photoURL || "https://api.dicebear.com/7.x/avataaars/svg?seed=default",
            createdAt: serverTimestamp()
        });
        chatInput.value = ''; 
    } catch (error) {
        console.error("Error sending: ", error);
    }
});

// 4. RENDER FUNCTION
function renderMessage(data, prepend = false) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message');
    const isMe = auth.currentUser && data.uid === auth.currentUser.uid;
    if (isMe) msgDiv.classList.add('my-message');

    const timeString = data.createdAt ? data.createdAt.toDate().toLocaleTimeString() : 'Sending...';

    msgDiv.innerHTML = `
        <img src="${data.photoURL}" alt="avatar" class="avatar">
        <div class="message-content">
            <div class="message-info">
                <span class="username">${data.displayName}</span>
                <span class="timestamp">${timeString}</span>
            </div>
            <p class="text">${data.text}</p>
        </div>
    `;

    prepend ? messageContainer.prepend(msgDiv) : messageContainer.appendChild(msgDiv);
}

scrollToBottomBtn.addEventListener('click', () => {
    messageContainer.scrollTo({ top: messageContainer.scrollHeight, behavior: 'smooth' });
});