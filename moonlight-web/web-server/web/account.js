
import { auth, db, doc, getDoc, updateDoc, updateProfile } from './firebase-init.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";

const usernameInput = document.getElementById('settings-username');
const emailInput = document.getElementById('settings-email');
const settingsForm = document.getElementById('settings-form');
const saveBtn = document.getElementById('save-settings-btn');
const photoPreview = document.getElementById('settings-photo-preview');

// Handle Auth State
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Populate Email
        if (emailInput) emailInput.value = user.email;

        // Populate Username (from Firestore preferences or Auth displayName)
        let currentUsername = user.displayName;
        if (user.photoURL && photoPreview) photoPreview.src = user.photoURL;

        /* ... existing Firestore fetch logic ... */
        try {
            const userDocRef = doc(db, "users", user.uid);
            const docSnap = await getDoc(userDocRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.username) currentUsername = data.username;
            }
        } catch (e) {
            console.warn("Could not fetch user doc:", e);
        }

        if (usernameInput) usernameInput.value = currentUsername || "";

    } else {
        // Not logged in, redirect
        window.location.replace("login.html");
    }
});

// Handle Form Submit
if (settingsForm) {
    settingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newUsername = usernameInput.value.trim();
        const user = auth.currentUser;

        if (!user || !newUsername) return;

        // Disable button
        const originalText = saveBtn.innerText;
        saveBtn.innerText = "Saving...";
        saveBtn.disabled = true;

        try {
            // 1. Update Auth Profile
            await updateProfile(user, { displayName: newUsername });

            // 2. Update Firestore
            const userDocRef = doc(db, "users", user.uid);
            await updateDoc(userDocRef, {
                username: newUsername,
                usernameLower: newUsername.toLowerCase()
            });

            alert("Account updated successfully!");
            window.location.href = "homepage.html";

        } catch (error) {
            console.error(error);
            alert("Error updating profile: " + error.message);
            saveBtn.innerText = originalText;
            saveBtn.disabled = false;
        }
    });
}
