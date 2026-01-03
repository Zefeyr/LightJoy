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
    endBefore,
    where,
    doc,
    updateDoc,
    setDoc,
    deleteDoc,
    getDoc,
    arrayUnion
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

// --- STATE MANAGEMENT ---
let currentChatId = "global"; // 'global' or 'dm_uidA_uidB'
let currentChatType = "global"; // 'global' or 'dm'
let currentChatUnsubscribe = null;
let currentFriendRequestDocId = null; // For updating "read" status in DM
let currentChatFriendUid = null;      // For updating "unread" status when sending

let oldestDoc = null;
let isLoadingMore = false;
let hasMoreMessages = true;

// --- DOM ELEMENTS ---
const messageContainer = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatHeaderTitle = document.querySelector('.chat-header h2');
const dmList = document.getElementById('dm-list');
const globalChannelBtn = document.querySelector('.channel.active'); // Note: selector might be fragile if active changes
const globalBadge = document.getElementById('global-badge');
const requestsBadge = document.getElementById('requests-badge');

const modals = {
    addFriend: document.getElementById('add-friend-modal'),
    requests: document.getElementById('requests-modal'),
    createGroup: document.getElementById('create-group-modal'),
    groupInfo: document.getElementById('group-info-modal'),
    addMember: document.getElementById('modal-add-member')
};

const btns = {
    openAdd: document.getElementById('open-add-friend'),
    closeAdd: document.getElementById('close-add-friend'),
    openRequests: document.getElementById('open-requests'),
    closeRequests: document.getElementById('close-requests'),
    submitAdd: document.getElementById('submit-add-friend'),
    openCreateGroup: document.getElementById('open-create-group'),
    closeCreateGroup: document.getElementById('close-create-group'),
    submitCreateGroup: document.getElementById('submit-create-group'),
    closeAddMember: document.getElementById('close-add-member'),
    submitAddMember: document.getElementById('submit-add-member')
};

const inputs = {
    friend: document.getElementById('friend-input'),
    requestsList: document.getElementById('friend-requests-list'),
    groupName: document.getElementById('group-name-input'),
    groupFriendList: document.getElementById('group-friend-list'),
    infoGroupName: document.getElementById('info-group-name'),
    infoGroupMembers: document.getElementById('info-group-members'),
    closeGroupInfo: document.getElementById('close-group-info'),
    addMemberList: document.getElementById('add-member-list')
};

if (inputs.closeGroupInfo) inputs.closeGroupInfo.onclick = () => toggleModal(modals.groupInfo, false);

// --- COLLAPSIBLE SIDEBAR SECTIONS ---
function setupCollapsible(headerId, listId) {
    const header = document.getElementById(headerId);
    const list = document.getElementById(listId);
    if (header && list) {
        header.onclick = (e) => {
            if (e.target.tagName === 'BUTTON') return; // Don't collapse if clicking + button
            list.classList.toggle('collapsed');
            const arrow = header.querySelector('.arrow');
            if (arrow) arrow.classList.toggle('collapsed');
        };
    }
}
// Init Collapsibles
setupCollapsible('header-groups', 'group-list');
setupCollapsible('header-dms', 'dm-list');

// --- GLOBAL USER CACHE ---
const userCache = new Map();
async function getLatestUsername(uid, fallback) {
    if (!uid) return fallback;
    if (userCache.has(uid)) return userCache.get(uid);
    try {
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) {
            const name = snap.data().username;
            userCache.set(uid, name);
            return name;
        }
    } catch (e) { console.warn("Fetch user failed", uid); }
    return fallback;
}

const groupList = document.getElementById('group-list');

// Scroll Button
const scrollToBottomBtn = document.createElement('button');
scrollToBottomBtn.innerHTML = "↓ New Messages";
scrollToBottomBtn.id = "scroll-btn";
scrollToBottomBtn.style.display = "none";
document.body.appendChild(scrollToBottomBtn);

// --- 1. CHAT LOGIC (Global & DM) ---

// Initial Load
subscribeToChat("global");
// listenForGlobalBadge(); // DISABLED per user request

// Function to subscribe to a chat channel
function subscribeToChat(chatId, targetName = "Global Chat") {
    // 1. Cleanup previous listener
    if (currentChatUnsubscribe) {
        currentChatUnsubscribe();
        currentChatUnsubscribe = null;
    }

    // 2. Reset State
    currentChatId = chatId;
    if (chatId === "global") currentChatType = "global";
    else if (chatId.startsWith('group_')) currentChatType = "group";
    else currentChatType = "dm";

    // --- UI Resets ---
    messageContainer.innerHTML = '';
    oldestDoc = null;
    hasMoreMessages = true;

    // 3. Update UI
    let displayTitle = targetName;
    if (currentChatType === 'global') displayTitle = "# global-chat";
    else if (currentChatType === 'group') displayTitle = "# " + targetName;
    else displayTitle = "@ " + targetName;

    chatHeaderTitle.textContent = displayTitle;
    chatInput.placeholder = `Message ${displayTitle}`;

    if (chatId === 'global') {
        // We are entering global chat -> Clear Badge
        globalBadge.classList.remove('active');
        localStorage.setItem('read_global_time', new Date().toISOString());

        const globalBtn = document.querySelector('.channel');
        if (globalBtn) globalBtn.classList.add('active');
    } else {
        const globalBtn = document.querySelector('.channel');
        if (globalBtn) globalBtn.classList.remove('active');
    }

    // Deactivate all sidebar items
    document.querySelectorAll('.friend-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.group-item').forEach(el => el.classList.remove('active'));

    // 4. Define Query
    let msgQuery;
    if (currentChatType === "global") {
        const messagesCol = collection(db, "messages");
        msgQuery = query(messagesCol, orderBy("createdAt", "asc"), limitToLast(50));
    } else if (currentChatType === "group") {
        // Extract Doc ID from group_DOCID
        const groupDocId = chatId.replace('group_', '');
        const messagesCol = collection(db, "groups", groupDocId, "messages");
        msgQuery = query(messagesCol, orderBy("createdAt", "asc"), limitToLast(50));
    } else {
        const messagesCol = collection(db, "direct_messages", chatId, "messages");
        msgQuery = query(messagesCol, orderBy("createdAt", "asc"), limitToLast(50));
    }

    // 5. Start Listener
    currentChatUnsubscribe = onSnapshot(msgQuery, (snapshot) => {
        if (!oldestDoc && !snapshot.empty) {
            oldestDoc = snapshot.docs[0];
        }

        const isAtBottom = messageContainer.scrollHeight - messageContainer.scrollTop <= messageContainer.clientHeight + 100;

        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                renderMessage(change.doc.data(), false);
            }
        });

        if (isAtBottom || snapshot.docChanges().length > 10) {
            messageContainer.scrollTop = messageContainer.scrollHeight;
        }
    });
}

// Global Chat Click Handler
// We need to find the element again since we might have lost reference
document.querySelector('.channel').onclick = () => subscribeToChat("global");


// --- 2. SEND MESSAGE ---
chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    const text = chatInput.value.trim();
    if (text === "" || !user) return;

    let targetCol;
    if (currentChatType === "global") {
        targetCol = collection(db, "messages");
    } else if (currentChatType === "group") {
        const groupDocId = currentChatId.replace('group_', '');
        targetCol = collection(db, "groups", groupDocId, "messages");
    } else {
        targetCol = collection(db, "direct_messages", currentChatId, "messages");
    }

    try {
        await addDoc(targetCol, {
            text: text,
            uid: user.uid,
            displayName: user.displayName || user.email.split('@')[0] || "Gamer",
            photoURL: user.photoURL || "https://api.dicebear.com/7.x/avataaars/svg?seed=default",
            createdAt: serverTimestamp()
        });

        // NOTIFICATION LOGIC: Group
        if (currentChatType === 'group') {
            const groupDocId = currentChatId.replace('group_', '');
            updateDoc(doc(db, "groups", groupDocId), {
                lastMessageTime: serverTimestamp(),
                lastMessageBy: user.uid
            }).catch(e => console.error("Update group time failed", e));
        }

        // NOTIFICATION LOGIC: If DM, update the friend request doc to show "unread" for the OTHER person
        if (currentChatType === 'dm' && currentFriendRequestDocId && currentChatFriendUid) {
            // Write to the document that links us
            const reqRef = doc(db, "friend_requests", currentFriendRequestDocId);
            // We set 'hasUnreadFor' to the recipient's UID (Legacy) AND update timestamps
            updateDoc(reqRef, {
                hasUnreadFor: currentChatFriendUid,
                lastMessageTime: serverTimestamp(),
                lastMessageBy: user.uid
            }).catch(err => console.error("Failed to set unread:", err));
        }

        chatInput.value = '';
    } catch (error) {
        console.error("Error sending: ", error);
        alert("Failed to send message. Check console.");
    }
});


// --- 3. FRIEND LIST & NOTIFICATIONS ---

// HEARTBEAT SYSTEM (Real Presence)
function startHeartbeat() {
    if (!auth.currentUser) return;
    const userRef = doc(db, "users", auth.currentUser.uid);

    // Update immediately and then every 60s
    const beat = () => {
        updateDoc(userRef, {
            lastSeen: serverTimestamp(),
            isOnline: true
        }).catch(e => console.warn("Heartbeat fail", e));
    };

    beat();
    setInterval(beat, 5000); // 5 seconds
}


// Listen for Pending Requests Count
function listenForPendingRequests() {
    if (!auth.currentUser) return;
    const q = query(collection(db, "friend_requests"),
        where("to", "==", auth.currentUser.uid),
        where("status", "==", "pending")
    );

    onSnapshot(q, (snap) => {
        const count = snap.size;
        if (count > 0) {
            requestsBadge.textContent = count;
            requestsBadge.classList.add('active');
        } else {
            requestsBadge.classList.remove('active');
        }
    });
}


function loadFriendList() {
    if (!auth.currentUser) return;
    try { startHeartbeat(); } catch (e) { } // Start signalling I am online
    listenForPendingRequests();
    loadGroupList(); // Start Group Listener

    const myUid = auth.currentUser.uid;
    dmList.innerHTML = '';



    // Roster Elements

    // Roster Elements
    const rosterOnline = document.getElementById('roster-online');
    const rosterOffline = document.getElementById('roster-offline');
    const onlineCount = document.getElementById('online-count');
    const friendCount = document.getElementById('friend-count');

    if (rosterOnline) rosterOnline.innerHTML = '';
    if (rosterOffline) rosterOffline.innerHTML = '';

    let totalFriends = 0;

    // Helper to update counts
    const updateCounts = () => {
        if (friendCount) friendCount.innerText = totalFriends;
    };

    // --- OPEN DM STATE MANAGEMENT ---
    const getOpenDMs = () => {
        const stored = localStorage.getItem('joy_open_dms');
        return stored ? JSON.parse(stored) : [];
    };

    const addOpenDM = (uid) => {
        const current = getOpenDMs();
        if (!current.includes(uid)) {
            current.push(uid);
            localStorage.setItem('joy_open_dms', JSON.stringify(current));
        }
    };

    const removeOpenDM = (uid) => {
        const current = getOpenDMs();
        const newDms = current.filter(id => id !== uid);
        localStorage.setItem('joy_open_dms', JSON.stringify(newDms));
    };

    // Helper to render friend
    const renderFriend = (docId, uid, username, photo, hasUnread) => {
        // --- 1. LEFT SIDEBAR (Direct Messages) ---
        // Logic: Show IF hasUnread OR isInOpenDMs
        const isOpen = getOpenDMs().includes(uid);
        const shouldShow = hasUnread || isOpen;

        if (!shouldShow) {
            // If it exists but shouldn't, remove it (e.g. closed via another tab/logic)
            const existing = document.getElementById(`friend-${uid}`);
            if (existing) existing.remove();
        } else {
            const badgeClass = hasUnread ? "badge active" : "badge";
            // Check if exists, if not create
            let friendItem = document.getElementById(`friend-${uid}`);

            if (!friendItem) {
                friendItem = document.createElement('div');
                friendItem.className = 'friend-item';
                friendItem.id = `friend-${uid}`;

                friendItem.innerHTML = `
                    <div style="display:flex; align-items:center; flex:1; overflow:hidden;">
                        <span class="status offline" id="status-l-${uid}"></span> 
                        <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${username || 'Friend'}</span>
                        <span class="badge">!</span>
                    </div>
                    <div class="kebab-container hidden-kebab">
                        <button class="kebab-btn">⋮</button>
                        <div class="kebab-dropdown">
                            <button class="close-dm-option">Remove Chat</button>
                        </div>
                    </div>
                `;

                const kBtn = friendItem.querySelector('.kebab-btn');
                const kDrop = friendItem.querySelector('.kebab-dropdown');
                const kClose = friendItem.querySelector('.close-dm-option');

                kBtn.onclick = (e) => {
                    e.stopPropagation();
                    document.querySelectorAll('.kebab-dropdown').forEach(d => d.classList.remove('active'));
                    kDrop.classList.add('active');
                };

                kClose.onclick = (e) => {
                    e.stopPropagation();
                    removeOpenDM(uid); // Update State
                    friendItem.remove(); // Visual Remove
                };

                friendItem.onclick = () => {
                    document.querySelectorAll('.friend-item').forEach(el => el.classList.remove('active'));
                    friendItem.classList.add('active');

                    // Keep Open logic - Ensure it stays open
                    addOpenDM(uid);

                    // Clear Badge HTML locally
                    friendItem.querySelector('.badge').classList.remove('active');
                    if (document.getElementById(`all-roster-${uid}`)) {
                        const b = document.getElementById(`all-roster-${uid}`).querySelector('.badge');
                        if (b) b.classList.remove('active');
                    }

                    // On Click: Set Read Time locally
                    localStorage.setItem('read_dm_' + uid, new Date().toISOString());

                    currentFriendRequestDocId = docId;
                    currentChatFriendUid = uid;
                    const chatId = [myUid, uid].sort().join('_');
                    subscribeToChat(chatId, username);
                };
                dmList.appendChild(friendItem);
            }

            // Always update badge
            const badge = friendItem.querySelector('.badge');
            if (badge) badge.className = badgeClass;
        }


        // --- 2. RIGHT SIDEBAR (All Friends) - With Kebab ---
        // Basic duplicate check to prevent infinite appending on re-renders
        if (!document.getElementById(`all-roster-${uid}`)) {
            const allFriendItem = document.createElement('div');
            allFriendItem.className = 'friend-item'; // Reuse styling
            allFriendItem.id = `all-roster-${uid}`;
            // Use same badge logic (Live Read applied)
            const badgeClassR = hasUnread ? "badge active" : "badge";

            allFriendItem.innerHTML = `
                <div style="display:flex; align-items:center; flex:1; overflow:hidden;">
                    <span class="status offline" id="status-r-${uid}"></span> 
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${username || 'Friend'}</span>
                    <span class="badge">!</span>
                </div>
                <div class="kebab-container">
                    <button class="kebab-btn">⋮</button>
                    <div class="kebab-dropdown">
                        <button class="unfriend-option">Unfriend</button>
                    </div>
                </div>
            `;

            const outputKebabBtn = allFriendItem.querySelector('.kebab-btn');
            const outputDropdown = allFriendItem.querySelector('.kebab-dropdown');
            const unfriendBtn = allFriendItem.querySelector('.unfriend-option');

            outputKebabBtn.onclick = (e) => {
                e.stopPropagation();
                document.querySelectorAll('.kebab-dropdown').forEach(d => d.classList.remove('active'));
                outputDropdown.classList.toggle('active');
            };

            unfriendBtn.onclick = async (e) => {
                e.stopPropagation();
                if (confirm(`Unfriend ${username}?`)) {
                    // Delete Friend Request Doc
                    try {
                        // Deleting the doc removes it for BOTH users
                        // Wait, we need docId.
                        // We have docId from closure.
                        // Standard Firestore delete
                        // Import deleteDoc if needed, or update status?
                        // Actually, we usually delete the request doc.
                        // But we need deleteDoc imported? 
                        // Check imports. If not, use update status='deleted' or something?
                        // Assuming deleteDoc is missing, I'll allow update or assume user has deleteDoc.
                        // Actually, I can use updateDoc to status 'rejected' or just hide?
                        // Let's assume deleteDoc is not imported, so I won't use it yet.
                        // Just alert for now or try delete.
                        // Better: updateDoc to 'rejected'
                        await updateDoc(doc(db, "friend_requests", docId), { status: 'rejected' });
                    } catch (err) {
                        console.error("Error unfriending:", err);
                        alert("Failed. Check console.");
                    }
                }
                outputDropdown.classList.remove('active');
            };

            // Interaction logic
            allFriendItem.onclick = () => {
                addOpenDM(uid); // Make visible in Left Sidebar

                // Force Left Sidebar to render immediately if not present
                if (!document.getElementById(`friend-${uid}`)) {
                    renderFriend(docId, uid, username, photo, hasUnread);
                }
                const lItem = document.getElementById(`friend-${uid}`);
                if (lItem) lItem.click();
            };

            if (rosterOffline) rosterOffline.appendChild(allFriendItem);
            totalFriends++;
            updateCounts();
        } else {
            // If Right Sidebar Item exists, update its badge
            const existingR = document.getElementById(`all-roster-${uid}`);
            if (existingR) {
                const badgeR = existingR.querySelector('.badge');
                // badgeClassR is defined above using 'hasUnread'
                const badgeClassR = hasUnread ? "badge active" : "badge";
                if (badgeR) badgeR.className = badgeClassR;
            }
        }


        // --- 3. PRESENCE LISTENER ---
        // We listen to the friend's user doc to see if they are online
        if (!window.presenceListeners) window.presenceListeners = {};
        if (!window.presenceListeners[uid]) {
            window.presenceListeners[uid] = onSnapshot(doc(db, "users", uid), (userSnap) => {
                if (!userSnap.exists()) return;
                const userData = userSnap.data();
                const lastSeen = userData.lastSeen;

                let isOnline = false;
                // Check if lastSeen is within 10 seconds
                if (lastSeen) {
                    const now = new Date();
                    const seen = lastSeen.toDate();
                    const diff = (now - seen) / 1000; // seconds
                    if (diff < 10) isOnline = true;
                }

                // UI FOR STATUS
                const colorClass = isOnline ? "status online" : "status offline";
                const dotL = document.getElementById(`status-l-${uid}`);
                const dotR = document.getElementById(`status-r-${uid}`);
                if (dotL) dotL.className = colorClass;
                if (dotR) dotR.className = colorClass;

                // MANAGE 'ONLINE' SECTION
                const onlineItemId = `online-roster-${uid}`;
                const existingOnlineItem = document.getElementById(onlineItemId);

                if (isOnline) {
                    if (!existingOnlineItem && rosterOnline) {
                        const onlineItem = document.createElement('div');
                        onlineItem.className = 'user-item';
                        onlineItem.id = onlineItemId;
                        onlineItem.style.cssText = "padding: 5px 10px; cursor: pointer; display: flex; align-items: center; color: rgba(255,255,255,0.7);";
                        onlineItem.innerHTML = `<span class="status online"></span> ${username || 'Friend'}`;

                        onlineItem.onclick = () => {
                            addOpenDM(uid); // Make visible
                            if (!document.getElementById(`friend-${uid}`)) {
                                renderFriend(docId, uid, username, photo, hasUnread);
                            }
                            const lItem = document.getElementById(`friend-${uid}`);
                            if (lItem) lItem.click();
                        };

                        rosterOnline.appendChild(onlineItem);
                    }
                } else {
                    if (existingOnlineItem) existingOnlineItem.remove();
                }

                // Hacky count update based on DOM
                if (onlineCount && rosterOnline) onlineCount.innerText = rosterOnline.children.length;
            });
        }
    }


    // 1. Incoming Accepted Friends
    const q1 = query(collection(db, "friend_requests"),
        where("to", "==", myUid),
        where("status", "==", "accepted")
    );

    // Helpers for DM Read Time
    const getDMReadTime = (uid) => {
        const stored = localStorage.getItem('read_dm_' + uid);
        return stored ? new Date(stored).getTime() : 0;
    };
    const setDMReadTime = (uid) => {
        localStorage.setItem('read_dm_' + uid, new Date().toISOString());
    };

    onSnapshot(q1, (snapshot) => {
        snapshot.docs.forEach(async docSnap => {
            const data = docSnap.data();
            const friendUid = data.from;

            // Standardized Badge Logic (Matches Groups)
            const lastMsgTime = data.lastMessageTime ? data.lastMessageTime.toDate().getTime() : 0;
            const lastRead = getDMReadTime(friendUid);
            const sentByMe = data.lastMessageBy === myUid;

            // Reconstruct DM Chat ID for robust comparison
            const dmId = [myUid, friendUid].sort().join('_');
            const isActive = currentChatId === dmId;

            const isUnread = false; // DISABLED

            // Live Auto-Read If Active
            if (isActive) {
                setDMReadTime(friendUid);
            }

            // Always fetch latest name
            const name = await getLatestUsername(friendUid, data.fromName || "Friend");
            renderFriend(docSnap.id, friendUid, name, data.fromPhoto, isUnread);
        });
    });

    // 2. Outgoing Accepted Friends
    const q2 = query(collection(db, "friend_requests"),
        where("from", "==", myUid),
        where("status", "==", "accepted")
    );

    onSnapshot(q2, (snapshot) => {
        snapshot.docs.forEach(async docSnap => {
            const data = docSnap.data();
            const friendUid = data.to;

            // Standardized Badge Logic (Matches Groups)
            const lastMsgTime = data.lastMessageTime ? data.lastMessageTime.toDate().getTime() : 0;
            const lastRead = getDMReadTime(friendUid);
            const sentByMe = data.lastMessageBy === myUid;

            const dmId = [myUid, friendUid].sort().join('_');
            const isActive = currentChatId === dmId;

            const isUnread = false; // DISABLED

            if (isActive) {
                setDMReadTime(friendUid);
            }

            // Always fetch latest name
            const name = await getLatestUsername(friendUid, data.toName || "Friend");
            renderFriend(docSnap.id, friendUid, name, data.toPhoto, isUnread);
        });
    }, (error) => {
        console.error("Error listening to outgoing friends:", error);
        if (error.code === 'failed-precondition') {
            alert("Database Index Missing! Open Console (F12) and click the link from Firebase to create it.");
        }
    });
}

// Call loadFriendList when auth is ready
auth.onAuthStateChanged(user => {
    if (user) {
        loadFriendList();
    }
});


// --- 4. FRIEND SYSTEM LOGIC (Existing + Updates) ---

// Toggle Modal
function toggleModal(modal, show) {
    if (modal) {
        if (show) modal.classList.add('active');
        else modal.classList.remove('active');
    }
}

if (btns.openAdd) btns.openAdd.onclick = () => toggleModal(modals.addFriend, true);
if (btns.closeAdd) btns.closeAdd.onclick = () => toggleModal(modals.addFriend, false);

if (btns.openRequests) btns.openRequests.onclick = () => {
    toggleModal(modals.requests, true);
    loadFriendRequests();
};
if (btns.closeRequests) btns.closeRequests.onclick = () => toggleModal(modals.requests, false);

// Add Member Modal Close
if (btns.closeAddMember) btns.closeAddMember.onclick = () => toggleModal(modals.addMember, false);

// Close on outside click
window.onclick = (e) => {
    Object.values(modals).forEach(m => {
        if (e.target == m) toggleModal(m, false);
    });

    // Close Kebab Dropdowns
    if (!e.target.closest('.kebab-container')) {
        document.querySelectorAll('.kebab-dropdown').forEach(d => d.classList.remove('active'));
    }
};

// --- ADD FRIEND LOGIC ---
if (btns.submitAdd) {
    btns.submitAdd.onclick = async () => {
        const inputVal = inputs.friend.value.trim();
        if (!inputVal) return;

        btns.submitAdd.innerText = "Checking...";
        btns.submitAdd.disabled = true;

        let targetUid = null;
        let targetData = null;

        // STEP 1: FIND USER
        try {
            // Priority 1: Check by Username
            let q = query(collection(db, "users"), where("username", "==", inputVal));
            let querySnap = await getDocs(q);

            // Priority 2: Check by Email
            if (querySnap.empty) {
                q = query(collection(db, "users"), where("email", "==", inputVal));
                querySnap = await getDocs(q);
            }

            if (querySnap.empty) {
                alert("User not found: " + inputVal);
                resetFriendBtn();
                return;
            }

            const targetUser = querySnap.docs[0];
            targetUid = targetUser.id;
            targetData = targetUser.data();

            if (targetUid === auth.currentUser.uid) {
                alert("You cannot add yourself.");
                resetFriendBtn();
                return;
            }

        } catch (e) {
            console.error("Search Error:", e);
            alert("Error searching for user: " + e.message);
            resetFriendBtn();
            return;
        }

        // STEP 2: CHECK EXISTING REQUEST (Optional - Log error but don't block if fails)
        try {
            const existingReq = query(collection(db, "friend_requests"),
                where("from", "==", auth.currentUser.uid),
                where("to", "==", targetUid)
            );
            const existingSnap = await getDocs(existingReq);
            if (!existingSnap.empty) {
                alert("Friend request already sent!");
                resetFriendBtn();
                return;
            }
        } catch (e) {
            console.warn("Duplicate check failed (ignoring):", e);
        }

        // STEP 3: SEND REQUEST
        try {
            const toName = targetData.username || inputVal;
            const toPhoto = targetData.photoURL || "";

            await addDoc(collection(db, "friend_requests"), {
                from: auth.currentUser.uid,
                fromName: auth.currentUser.displayName || "Unknown",
                fromPhoto: auth.currentUser.photoURL || "",
                to: targetUid,
                toName: toName,
                toPhoto: toPhoto,
                status: 'pending',
                createdAt: serverTimestamp()
            });

            alert(`Request sent to ${toName}!`);
            toggleModal(modals.addFriend, false);
            inputs.friend.value = '';

        } catch (e) {
            console.error("Send Error:", e);
            alert("Failed to send request. " + e.message);
        }
        resetFriendBtn();
    };
}

function resetFriendBtn() {
    btns.submitAdd.innerText = "Send Request";
    btns.submitAdd.disabled = false;
}

// VIEW REQUESTS & ACCEPT LOGIC
async function loadFriendRequests() {
    if (!auth.currentUser) return;
    inputs.requestsList.innerHTML = '<div style="text-align:center; color:#aaa;">Loading...</div>';

    const q = query(collection(db, "friend_requests"),
        where("to", "==", auth.currentUser.uid),
        where("status", "==", "pending")
    );

    const snap = await getDocs(q);
    inputs.requestsList.innerHTML = '';

    if (snap.empty) {
        inputs.requestsList.innerHTML = '<div style="text-align:center; color:#aaa;">No pending requests</div>';
        return;
    }

    snap.forEach(docSnap => {
        const data = docSnap.data();
        const div = document.createElement('div');
        div.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:10px; margin-bottom:5px; border-radius:5px;";

        const isGroup = data.type === 'group_invite';
        const displayText = isGroup
            ? `<span>Invite to <b>#${data.groupName}</b> from ${data.fromName}</span>`
            : `<span>${data.fromName || 'User'}</span>`;

        div.innerHTML = `
            ${displayText}
            <div>
                <button class="modal-btn accept-btn" style="padding:5px 10px; font-size:0.8rem; background:#43b581; margin-right:5px;">Accept</button>
                <button class="modal-btn decline-btn" style="padding:5px 10px; font-size:0.8rem; background:#f04747;">Decline</button>
            </div>
        `;

        const acceptBtn = div.querySelector('.accept-btn');
        const declineBtn = div.querySelector('.decline-btn');

        acceptBtn.onclick = async () => {
            acceptBtn.disabled = true;
            acceptBtn.innerText = "...";

            try {
                if (isGroup) {
                    const groupRef = doc(db, "groups", data.groupId);
                    // Add myself to members
                    await updateDoc(groupRef, {
                        members: arrayUnion(auth.currentUser.uid)
                    });
                    await updateDoc(doc(db, "friend_requests", docSnap.id), { status: 'accepted' });
                    alert(`Joined group ${data.groupName}!`);
                } else {
                    // 1. Update Request Status
                    await updateDoc(doc(db, "friend_requests", docSnap.id), { status: 'accepted' });
                    alert("Friend accepted!");
                }

                div.remove();
                if (inputs.requestsList.children.length === 0) {
                    inputs.requestsList.innerHTML = '<div style="text-align:center; color:#aaa;">No pending requests</div>';
                }

            } catch (err) {
                console.error("Error accepting:", err);
                alert("Error: " + err.message);
                acceptBtn.disabled = false;
                acceptBtn.innerText = "Accept";
            }
        };

        declineBtn.onclick = async () => {
            await updateDoc(doc(db, "friend_requests", docSnap.id), { status: 'declined' });
            div.remove();
            if (inputs.requestsList.children.length === 0) {
                inputs.requestsList.innerHTML = '<div style="text-align:center; color:#aaa;">No pending requests</div>';
            }
        };

        inputs.requestsList.appendChild(div);
    });
}


// --- 6. GROUP CHAT LOGIC ---

if (btns.openCreateGroup) btns.openCreateGroup.onclick = () => {
    toggleModal(modals.createGroup, true);
    renderFriendSelection(inputs.groupFriendList, []);
};
if (btns.closeCreateGroup) btns.closeCreateGroup.onclick = () => toggleModal(modals.createGroup, false);

// Populate Friend Checkboxes
// Populate Friend Checkboxes
async function renderFriendSelection(container, excludeUids = []) {
    if (!container) return;
    container.innerHTML = '<div style="color:#aaa;">Loading friends...</div>';
    const myUid = auth.currentUser.uid;

    const friendMap = new Map(); // uid -> {name, photo}

    // Outgoing
    const q1 = query(collection(db, "friend_requests"), where("from", "==", myUid), where("status", "==", "accepted"));
    const s1 = await getDocs(q1);

    // Incoming
    const q2 = query(collection(db, "friend_requests"), where("to", "==", myUid), where("status", "==", "accepted"));
    const s2 = await getDocs(q2);

    // Process Outgoing (we sent req, friend is 'to')
    for (const d of s1.docs) {
        const da = d.data();
        if (excludeUids.includes(da.to)) continue;
        const name = await getLatestUsername(da.to, da.toName || "Friend");
        friendMap.set(da.to, { name: name, uid: da.to });
    }

    // Process Incoming (we received req, friend is 'from')
    for (const d of s2.docs) {
        const da = d.data();
        if (excludeUids.includes(da.from)) continue;
        const name = await getLatestUsername(da.from, da.fromName || "Friend");
        friendMap.set(da.from, { name: name, uid: da.from });
    }

    container.innerHTML = '';
    if (friendMap.size === 0) {
        container.innerHTML = '<div style="color:#aaa;">No friends found.</div>';
        return;
    }

    friendMap.forEach((user, uid) => {
        const label = document.createElement('label');
        label.style.cssText = "display:flex; align-items:center; padding:5px; cursor:pointer;";
        label.innerHTML = `
            <input type="checkbox" value="${uid}" style="margin-right:10px;">
            <span>${user.name}</span>
        `;
        container.appendChild(label);
    });
}

// Submit Create Group
if (btns.submitCreateGroup) btns.submitCreateGroup.onclick = async () => {
    const name = inputs.groupName.value.trim();
    if (!name) { alert("Enter a group name"); return; }

    const checkboxes = inputs.groupFriendList.querySelectorAll('input[type="checkbox"]:checked');
    const memberUids = [auth.currentUser.uid];
    // Note: We only add ourselves. Others must accept invites.

    btns.submitCreateGroup.innerText = "Creating...";
    btns.submitCreateGroup.disabled = true;

    try {
        const groupRef = await addDoc(collection(db, "groups"), {
            name: name,
            createdBy: auth.currentUser.uid,
            members: memberUids,
            admins: [auth.currentUser.uid],
            createdAt: serverTimestamp()
        });

        // Send Invites
        for (const cb of checkboxes) {
            const uid = cb.value;
            // Get name from label or fetch? Simplest to just send request
            await addDoc(collection(db, "friend_requests"), {
                type: 'group_invite',
                from: auth.currentUser.uid,
                fromName: auth.currentUser.displayName || "User",
                to: uid,
                groupId: groupRef.id,
                groupName: name,
                status: 'pending',
                createdAt: serverTimestamp()
            });
        }

        toggleModal(modals.createGroup, false);
        inputs.groupName.value = '';
    } catch (e) {
        console.error("Group Create Error:", e);
        alert("Failed to create group.");
    }
    btns.submitCreateGroup.innerText = "Create Group";
    btns.submitCreateGroup.disabled = false;
};


// Load Groups Listener
function getGroupReadTime(gid) {
    const stored = localStorage.getItem('read_group_' + gid);
    return stored ? new Date(stored).getTime() : 0;
}

function loadGroupList() {
    if (!auth.currentUser) return;
    const q = query(collection(db, "groups"), where("members", "array-contains", auth.currentUser.uid));

    onSnapshot(q, (snap) => {
        // We do a full rebuild for simplicity on small lists
        groupList.innerHTML = '';
        snap.forEach(docSnap => {
            const data = docSnap.data();
            const gItem = document.createElement('div');
            gItem.className = 'channel group-item'; // reuse channel style
            gItem.id = `group-${docSnap.id}`;

            // Check Badge
            const lastMsgTime = data.lastMessageTime ? data.lastMessageTime.toDate().getTime() : 0;
            const lastRead = getGroupReadTime(docSnap.id);
            const sentByMe = data.lastMessageBy === auth.currentUser.uid;
            const isUnread = !sentByMe && lastMsgTime > lastRead && currentChatId !== `group_${docSnap.id}`;
            const badgeClass = isUnread ? "badge active" : "badge";

            // Flex layout for kebab
            gItem.style.display = "flex";
            gItem.style.justifyContent = "space-between";
            gItem.style.alignItems = "center";

            gItem.innerHTML = `
                <div style="flex:1; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">
                    # ${data.name} <span class="${badgeClass}">!</span>
                </div>
                <div class="kebab-container" style="margin-left:5px;">
                     <button class="kebab-btn" style="padding:0 5px; color:#aaa;">⋮</button>
                     <div class="kebab-dropdown">
                         <button class="view-group-info">Group Info</button>
                         <button class="leave-group-option" style="color:#f04747;">Leave Group</button>
                     </div>
                </div>
            `;

            // Interaction
            const kBtn = gItem.querySelector('.kebab-btn');
            const kDrop = gItem.querySelector('.kebab-dropdown');
            const btnInfo = gItem.querySelector('.view-group-info');
            const btnLeave = gItem.querySelector('.leave-group-option');

            kBtn.onclick = (e) => {
                e.stopPropagation();
                document.querySelectorAll('.kebab-dropdown').forEach(d => d.classList.remove('active'));
                kDrop.classList.toggle('active');
            };

            btnInfo.onclick = (e) => {
                e.stopPropagation();
                kDrop.classList.remove('active');
                showGroupInfo(docSnap.id, data);
            };

            btnLeave.onclick = (e) => {
                e.stopPropagation();
                kDrop.classList.remove('active');
                leaveGroup(docSnap.id, data.name);
            };

            gItem.onclick = (e) => {
                // Prevent triggering if clicking Kebab area
                if (e.target.closest('.kebab-container')) return;

                document.querySelectorAll('.group-item').forEach(el => el.classList.remove('active'));
                gItem.classList.add('active');

                // Mark as read locally
                localStorage.setItem('read_group_' + docSnap.id, new Date().toISOString());
                // Remove badge immediately from UI
                const b = gItem.querySelector('.badge');
                if (b) b.classList.remove('active');

                subscribeToChat(`group_${docSnap.id}`, data.name);
            };

            // Check if active (re-rendering)
            if (currentChatId === `group_${docSnap.id}`) {
                gItem.classList.add('active');
                // Ensure read time is updated if we are active and new msg came
                localStorage.setItem('read_group_' + docSnap.id, new Date().toISOString());
            }

            groupList.appendChild(gItem);
        });
    });
}

// Group Actions
async function leaveGroup(groupId, groupName) {
    if (!confirm(`Are you sure you want to leave "${groupName}"?`)) return;

    try {
        const groupRef = doc(db, "groups", groupId);
        const groupSnap = await getDoc(groupRef);
        if (!groupSnap.exists()) return;

        const members = groupSnap.data().members || [];
        const newMembers = members.filter(uid => uid !== auth.currentUser.uid);

        // 1. Send "Left Group" Notification Message
        try {
            // Fetch own username
            let myName = "A member";
            const uSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
            if (uSnap.exists()) myName = uSnap.data().username;

            await addDoc(collection(db, "groups", groupId, "messages"), {
                text: `* ${myName} has left the group.`,
                uid: "system", // Mark as system for potential styling
                username: "System",
                createdAt: serverTimestamp()
            });
        } catch (msgErr) {
            console.error("Failed to send leave msg:", msgErr);
            // Continue leaving anyway
        }

        if (newMembers.length === 0) {
            // Delete group if empty? Or keep it? Let's delete to be clean
            await deleteDoc(groupRef);
        } else {
            await updateDoc(groupRef, { members: newMembers });
        }

        // Return to Global Chat
        subscribeToChat("global");

    } catch (e) {
        console.error("Leave Group Error:", e);
        alert("Failed to leave group: " + e.message);
    }
}

let activeGroupIdForInfo = null;

async function showGroupInfo(groupId, data) {
    activeGroupIdForInfo = groupId;
    toggleModal(modals.groupInfo, true);
    inputs.infoGroupName.textContent = `# ${data.name}`;
    inputs.infoGroupMembers.innerHTML = '<div style="color:#aaa;">Loading members...</div>';

    const members = data.members || [];
    const admins = data.admins || [data.createdBy];
    const myUid = auth.currentUser.uid;
    const isOwner = data.createdBy === myUid;
    const amAdmin = admins.includes(myUid);

    // Setup Add Member Button
    // Check if button exists in Modal, if not create/show it?
    // Current HTML might not have it. I should inject it or assume it's there?
    // I didn't add it to HTML in implementation plan Step 1253. Wait.
    // I added "Add Member" MODAL, but where is the button in "Group Info"?
    // I need to add that button dynamicallly here or to HTML.
    // Let's add it dynamically to 'infoGroupMembers' parent or separate container.
    // Assume I append it to 'inputs.infoGroupMembers' parent.
    // Or just prepend to members list.

    inputs.infoGroupMembers.innerHTML = '';

    // Add Member Button (For Admins)
    if (amAdmin) {
        const addBtn = document.createElement('button');
        addBtn.className = 'btn-primary';
        addBtn.style.width = '100%';
        addBtn.style.marginBottom = '10px';
        addBtn.textContent = "+ Add Member";
        addBtn.onclick = () => {
            toggleModal(modals.groupInfo, false); // Close Info? Or Keep? Better close.
            toggleModal(modals.addMember, true);
            renderFriendSelection(inputs.addMemberList, members);
        };
        inputs.infoGroupMembers.appendChild(addBtn);
    }

    for (const uid of members) {
        const div = document.createElement('div');
        div.style.cssText = "padding: 8px 5px; border-bottom: 1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between; align-items:center;";

        // Left: Name + Roles
        const leftDiv = document.createElement('div');
        leftDiv.style.display = "flex";
        leftDiv.style.alignItems = "center";
        leftDiv.style.gap = "8px";

        // Fetch Name
        let displayName = "Unknown";
        if (uid === auth.currentUser.uid) displayName = "You";
        else displayName = await getLatestUsername(uid, "User"); // Cached

        const nameSpan = document.createElement('span');
        nameSpan.textContent = displayName;
        leftDiv.appendChild(nameSpan);

        // Roles
        if (uid === data.createdBy) {
            const r = document.createElement('span');
            r.style.cssText = "background:#ffc107; color:#000; font-size:0.7rem; padding:1px 4px; border-radius:3px; font-weight:bold;";
            r.textContent = "OWNER";
            leftDiv.appendChild(r);
        } else if (admins.includes(uid)) {
            const r = document.createElement('span');
            r.style.cssText = "background:#0dcaf0; color:#000; font-size:0.7rem; padding:1px 4px; border-radius:3px; font-weight:bold;";
            r.textContent = "ADMIN";
            leftDiv.appendChild(r);
        }

        div.appendChild(leftDiv);

        // Right: Promote Button (For Owner)
        // Check conditions: I am Owner, Target is NOT Me, Target is NOT Admin
        if (isOwner && uid !== myUid && !admins.includes(uid)) {
            const promBtn = document.createElement('button');
            promBtn.style.cssText = "background:none; border:1px solid #0dcaf0; color:#0dcaf0; cursor:pointer; font-size:0.7rem; padding:2px 6px; border-radius:4px;";
            promBtn.textContent = "Promote";
            promBtn.onclick = async () => {
                if (confirm(`Promote ${displayName} to Admin?`)) {
                    try {
                        await updateDoc(doc(db, "groups", groupId), {
                            admins: arrayUnion(uid)
                        });
                        alert("Promoted!");
                        // Refresh info?
                        // Ideally we re-fetch group data. For now, close modal.
                        toggleModal(modals.groupInfo, false);
                    } catch (e) {
                        console.error("Promote Error:", e);
                        alert("Failed: " + e.message);
                    }
                }
            };
            div.appendChild(promBtn);
        }

        inputs.infoGroupMembers.appendChild(div);
    }
}

// Submit Add Member
if (btns.submitAddMember) btns.submitAddMember.onclick = async () => {
    if (!activeGroupIdForInfo) return;

    const checkboxes = inputs.addMemberList.querySelectorAll('input[type="checkbox"]:checked');
    if (checkboxes.length === 0) {
        alert("Select friends to add.");
        return;
    }

    const newMembers = [];
    checkboxes.forEach(cb => newMembers.push(cb.value));

    btns.submitAddMember.innerText = "Inviting...";
    btns.submitAddMember.disabled = true;

    try {
        // 1. Fetch Group Name
        const groupSnap = await getDoc(doc(db, "groups", activeGroupIdForInfo));
        if (!groupSnap.exists()) throw new Error("Group not found");
        const groupName = groupSnap.data().name;

        // 2. Send Invites
        const batchPromises = [];
        checkboxes.forEach(cb => {
            const friendUid = cb.value;
            const p = addDoc(collection(db, "friend_requests"), {
                from: auth.currentUser.uid,
                fromName: auth.currentUser.displayName || "User",
                fromPhoto: auth.currentUser.photoURL || "",
                to: friendUid,
                status: 'pending',
                type: 'group_invite',
                groupId: activeGroupIdForInfo,
                groupName: groupName,
                createdAt: serverTimestamp()
            });
            batchPromises.push(p);
        });

        await Promise.all(batchPromises);
        alert(`Invites sent to ${checkboxes.length} friends.`);
        toggleModal(modals.addMember, false);
        return;

        const groupRef = doc(db, "groups", activeGroupIdForInfo);

        // We cannot use arrayUnion with an array directly in the spread way if array is large, 
        // but for <10 it's fine. 
        // Firestore update: members: arrayUnion(...newMembers)
        // Wait, arrayUnion takes varargs.

        await updateDoc(groupRef, {
            members: arrayUnion(...newMembers)
        });

        alert("Members added!");
        toggleModal(modals.addMember, false);
        // Optionally reopen Group Info? Nah.

        // Notify new members? Logic handles badge. 
        // But we might want system messages.
        // Let's add system messages for each new member.
        const user = auth.currentUser;
        const subCol = collection(db, "groups", activeGroupIdForInfo, "messages");

        // This could be slow for many, but fine for prototype
        // Actually, let's just add one summary message
        await addDoc(subCol, {
            text: `${user.displayName || "Admin"} added ${newMembers.length} new member(s).`,
            uid: "system",
            createdAt: serverTimestamp()
        });

    } catch (e) {
        console.error("Add Member Error:", e);
        alert("Failed to add members: " + e.message);
    }

    btns.submitAddMember.innerText = "Add Selected";
    btns.submitAddMember.disabled = false;
};
// 5. RENDER FUNCTION
function renderMessage(data, prepend = false) {
    const msgDiv = document.createElement('div');

    // System Message Check
    if (data.uid === 'system') {
        msgDiv.style.cssText = "display:flex; justify-content:center; margin:15px 0; color:#aaa; font-style:italic; font-size:0.85rem;";
        msgDiv.textContent = data.text;
        prepend ? messageContainer.prepend(msgDiv) : messageContainer.appendChild(msgDiv);
        return;
    }

    msgDiv.classList.add('message');
    const isMe = auth.currentUser && data.uid === auth.currentUser.uid;
    if (isMe) msgDiv.classList.add('my-message');

    const timeString = data.createdAt ? data.createdAt.toDate().toLocaleTimeString() : 'Sending...';
    // Fallback for missing displayName/photo
    // Fallback for missing displayName/photo
    const initialName = data.displayName || data.username || "Unknown";
    const photo = data.photoURL || "resources/default-avatar.png";

    // Unique ID for this message's username field
    const nameElemId = `msg-name-${Math.random().toString(36).substr(2, 9)}`;

    msgDiv.innerHTML = `
        <img src="${photo}" alt="avatar" class="avatar">
        <div class="message-content">
            <div class="message-info">
                <span class="username" id="${nameElemId}">${initialName}</span>
                <span class="timestamp">${timeString}</span>
            </div>
            <p class="text">${data.text}</p>
        </div>
    `;

    prepend ? messageContainer.prepend(msgDiv) : messageContainer.appendChild(msgDiv);

    // Async Update Name
    if (data.uid) {
        getLatestUsername(data.uid, initialName).then(realName => {
            const el = document.getElementById(nameElemId);
            if (el && realName !== initialName) el.textContent = realName;
        });
    }

    prepend ? messageContainer.prepend(msgDiv) : messageContainer.appendChild(msgDiv);
}

scrollToBottomBtn.addEventListener('click', () => {
    messageContainer.scrollTo({ top: messageContainer.scrollHeight, behavior: 'smooth' });
});

// Infinite scroll logic (simplified for switch context)
messageContainer.addEventListener('scroll', async () => {
    const isScrolledUp = messageContainer.scrollHeight - messageContainer.scrollTop > messageContainer.clientHeight + 500;
    scrollToBottomBtn.style.display = isScrolledUp ? "block" : "none";
});