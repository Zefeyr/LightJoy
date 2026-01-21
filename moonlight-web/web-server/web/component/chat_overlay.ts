import { Component } from "./index.js";
// @ts-ignore
import { db, auth } from "../firebase-init.js";
// @ts-ignore
import {
    collection,
    query,
    orderBy,
    limitToLast,
    onSnapshot,
    addDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

export class ChatOverlay implements Component {
    private container!: HTMLElement;
    private chatBox!: HTMLElement;
    private toggleButton!: HTMLElement;
    private badge!: HTMLElement;
    private contentArea!: HTMLElement;
    private input!: HTMLInputElement;

    private isVisible = false;
    private unreadCount = 0;
    private unsubscribe: (() => void) | null = null;
    private onStateChange: ((isOpen: boolean) => void) | null = null;

    constructor(onStateChange?: (isOpen: boolean) => void) {
        this.onStateChange = onStateChange || null;
        this.container = document.createElement("div");
        this.container.id = "chat-overlay";
        Object.assign(this.container.style, {
            position: "fixed", top: "0", left: "0", width: "100%", height: "100%",
            pointerEvents: "none", zIndex: "2147483647"
        });

        this.injectStyles();
        this.createToggleButton();
        this.createChatBox();

        // Auto-connect to global chat
        setTimeout(() => this.connectToGlobalChat(), 1000);
    }

    private injectStyles() {
        const style = document.createElement("style");
        style.textContent = `
            .chat-toggle-btn {
                position: fixed; top: 10px; left: 50%; transform: translateX(30px);
                width: 40px; height: 40px;
                background: rgba(0,0,0,0.5); color: white;
                border-radius: 50%; display: flex; align-items: center; justify-content: center;
                cursor: pointer; pointer-events: auto; border: none;
                transition: all 0.3s; z-index: 999999; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
                box-shadow: 0 2px 10px rgba(0,0,0,0.5); visibility: visible;
            }
            .chat-toggle-btn.glow { box-shadow: 0 0 15px rgba(0, 123, 255, 0.8); border: 2px solid rgba(100, 181, 246, 0.8); }
            .chat-toggle-btn:hover { transform: translateX(30px) scale(1.1); background: rgba(50, 50, 50, 0.95); }
            
            .chat-badge {
                position: absolute; top: -2px; right: -2px; background: #ff5252; color: white;
                font-size: 10px; font-weight: bold; border-radius: 50%; min-width: 16px; height: 16px;
                display: flex; align-items: center; justify-content: center; opacity: 0; transform: scale(0);
                transition: 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            }
            .chat-badge.visible { opacity: 1; transform: scale(1); }

            .chat-box {
                position: fixed; top: 15%; left: 80px; width: 350px; height: 450px;
                background: rgba(20, 20, 20, 0.95); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 12px;
                display: flex; flex-direction: column; pointer-events: none; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
                z-index: 2001; transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
                opacity: 0; visibility: hidden; transform: translateX(-20px);
                box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            }
            .chat-box.visible { opacity: 1; visibility: visible; transform: translateX(0); pointer-events: auto; }

            @media (max-width: 1366px) {
                /* .chat-toggle-btn override removed to keep it at top */
                .chat-box {
                    left: 50% !important; top: 50% !important; width: 80% !important; height: 70% !important;
                    transform: translate(-50%, -50%) scale(1);
                }
                .chat-box.visible { transform: translate(-50%, -50%) scale(1); }
            }

            .chat-header {
                padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.1); font-weight: 600; color: white;
                display: flex; justify-content: space-between; align-items: center;
            }
            .chat-close { cursor: pointer; color: #aaa; }
            .chat-close:hover { color: #fff; }

            .chat-content {
                flex: 1; overflow-y: auto; padding: 12px; scrollbar-width: thin;
                scrollbar-color: rgba(255,255,255,0.2) transparent;
            }
            
            .message-row { margin-bottom: 8px; font-size: 13px; line-height: 1.4; }
            .message-user { color: #ce93d8; font-weight: 600; margin-right: 6px; }
            .message-text { color: rgba(255,255,255,0.9); word-wrap: break-word; }
            
            .input-container { padding: 12px; border-top: 1px solid rgba(255,255,255,0.1); display: flex; box-sizing: border-box; }
            .chat-input {
                flex: 1; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.2);
                color: white; padding: 10px; border-radius: 8px; outline: none;
                user-select: text !important; pointer-events: auto !important;
                box-sizing: border-box;
            }
            .chat-input:focus { border-color: #4285f4; }
            
            .chat-send-btn {
                background: none; border: none; color: #4285f4; font-size: 18px; cursor: pointer;
                padding: 0 0 0 10px; display: flex; align-items: center; justify-content: center;
            }
            .chat-send-btn:hover { color: #80b0ff; }
        `;
        this.container.appendChild(style);
    }

    private createToggleButton() {
        this.toggleButton = document.createElement("div");
        this.toggleButton.className = "chat-toggle-btn";
        this.toggleButton.innerHTML = "<span>💬</span>";

        this.badge = document.createElement("div");
        this.badge.className = "chat-badge";
        this.toggleButton.appendChild(this.badge);

        const toggle = (e: Event) => { e.stopPropagation(); this.toggle(); };
        this.toggleButton.addEventListener("click", toggle);
        this.toggleButton.addEventListener("touchend", toggle);
        this.container.appendChild(this.toggleButton);
    }

    private createChatBox() {
        this.chatBox = document.createElement("div");
        this.chatBox.className = "chat-box";

        // Stop bubbling for all interaction events to prevent the stream from stealing focus
        ["keydown", "keyup", "mousedown", "mouseup", "touchstart", "touchend", "touchmove", "click", "wheel", "contextmenu"].forEach(evt =>
            this.chatBox.addEventListener(evt, (e) => e.stopPropagation())
        );

        const header = document.createElement("div");
        header.className = "chat-header";

        const title = document.createElement("span");
        title.innerText = "Community";
        header.appendChild(title);

        const closeBtn = document.createElement("span");
        closeBtn.className = "chat-close";
        closeBtn.innerHTML = "&times;";
        // Use explicit onclick with stopPropagation
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            this.toggle();
        };
        // Also add touchend for mobile responsiveness
        closeBtn.ontouchend = (e) => {
            e.stopPropagation();
            e.preventDefault(); // Prevent ghost clicks
            this.toggle();
        };
        header.appendChild(closeBtn);

        this.chatBox.appendChild(header);

        this.contentArea = document.createElement("div");
        this.contentArea.className = "chat-content";
        this.chatBox.appendChild(this.contentArea);

        const inputContainer = document.createElement("div");
        inputContainer.className = "input-container";

        this.input = document.createElement("input");
        this.input.className = "chat-input";
        this.input.placeholder = "Type a message...";

        // Mobile Keyboard Fix:
        // Do NOT call focus() on touchstart; let the browser's default click behavior handle it.
        // Just stop propagation so it doesn't affect the stream.
        const stopProp = (e: Event) => e.stopPropagation();

        this.input.addEventListener("touchstart", stopProp, { passive: true });
        this.input.addEventListener("touchend", stopProp); // Do not preventDefault, or click won't fire
        this.input.addEventListener("mousedown", stopProp);
        this.input.addEventListener("click", stopProp); // Vital for the keyboard to appear on mobile

        this.input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") this.sendMessage();
        });

        const sendBtn = document.createElement("button");
        sendBtn.innerHTML = "➤";
        sendBtn.className = "chat-send-btn";
        sendBtn.addEventListener("click", (e) => { e.stopPropagation(); this.sendMessage(); });
        sendBtn.addEventListener("touchend", (e) => {
            e.stopPropagation(); e.preventDefault();
            this.sendMessage();
        });

        inputContainer.appendChild(this.input);
        inputContainer.appendChild(sendBtn);
        this.chatBox.appendChild(inputContainer);

        this.container.appendChild(this.chatBox);
    }

    private connectToGlobalChat() {
        const q = query(collection(db, "messages"), orderBy("createdAt", "asc"), limitToLast(50));
        this.unsubscribe = onSnapshot(q,
            (snap: any) => {
                this.contentArea.innerHTML = "";
                snap.forEach((doc: any) => this.renderMessage(doc.data()));
                this.contentArea.scrollTop = this.contentArea.scrollHeight;
            },
            (error: any) => {
                // This will tell you if the iPad is being blocked
                console.error("Firestore Error on iPad:", error);
                const errorEl = document.createElement("div");
                errorEl.style.color = "red";
                errorEl.innerText = "Connection Error: " + error.message;
                this.contentArea.appendChild(errorEl);
            }
        );
    }

    private renderMessage(data: any) {
        // @ts-ignore
        const isMe = auth.currentUser && data.uid === auth.currentUser.uid;
        const color = isMe ? "#4285f4" : "#ce93d8"; // Blue if me, Purple default

        const el = document.createElement("div");
        el.className = "message-row";
        el.innerHTML = `
            <span class="message-user" style="color:${color}">${data.displayName}:</span>
            <span class="message-text">${data.text}</span>
        `;
        this.contentArea.appendChild(el);

        if (!this.isVisible) {
            this.unreadCount++;
            this.updateBadge();
        }
    }

    private async sendMessage() {
        const text = this.input.value.trim();
        // @ts-ignore
        if (!text || !auth.currentUser) return;

        // @ts-ignore
        const user = auth.currentUser;

        try {
            // @ts-ignore
            await addDoc(collection(db, "messages"), {
                text,
                uid: user.uid,
                displayName: user.displayName || "User",
                createdAt: serverTimestamp()
            });
            this.input.value = "";
        } catch (e) {
            console.error(e);
        }
    }

    private toggle() {
        this.isVisible = !this.isVisible;
        this.chatBox.classList.toggle("visible", this.isVisible);
        this.toggleButton.style.display = this.isVisible ? "none" : "flex";

        if (this.isVisible) {
            this.unreadCount = 0;
            this.updateBadge();
            // Use requestAnimationFrame to ensure the element is visible before focusing
            requestAnimationFrame(() => {
                this.input.focus();
            });
        }

        if (this.onStateChange) {
            // This calls the callback in ViewerApp which runs this.focusInput()
            this.onStateChange(this.isVisible);
        }
    }

    private updateBadge() {
        this.badge.innerText = this.unreadCount > 9 ? "9+" : this.unreadCount.toString();
        this.badge.classList.toggle("visible", this.unreadCount > 0);
    }

    mount(parent: HTMLElement) { parent.appendChild(this.container); }
    unmount(parent: HTMLElement) {
        if (this.unsubscribe) this.unsubscribe();
        if (this.container.parentElement === parent) parent.removeChild(this.container);
    }
}
