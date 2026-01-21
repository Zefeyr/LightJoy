// app.js

// Import necessary functions from your initialization file (firebase-init.js)
import {
    auth,
    db,
    googleProvider,
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signOut,
    updateProfile,
    doc,
    setDoc,
    getDoc,
    setPersistence,
    browserSessionPersistence,
    browserLocalPersistence,
    serverTimestamp,
    updateDoc
} from './firebase-init.js';


// --- Function to create or verify user document in Firestore ---
const createUserProfileDocument = async (user, Username = null) => {
    const userRef = doc(db, "users", user.uid);
    try {
        const docSnap = await getDoc(userRef);

        if (docSnap.exists()) {
            // If the document already exists, we assume the username was correctly set
            // during signup or a previous operation. We do not overwrite it here
            // to avoid race conditions with onAuthStateChanged.
            console.log("User profile already exists in Firestore. Not updating username during this call.");
        } else {
            // Document does not exist, so create it.
            // Prioritize customUsername if provided (from signup),
            // otherwise use user.displayName (e.g., from Google Sign-In), then fallback to email.
            const usernameToSet = Username || user.displayName || user.email.split('@')[0];
            await setDoc(userRef, {
                username: usernameToSet,
                email: user.email,
                createdAt: new Date()
            });
            console.log("User profile created in Firestore with username:", usernameToSet);
        }
    } catch (error) {
        console.error("Error creating user profile:", error);
    }
};



// --- 1. HANDLE LOGOUT FUNCTION ---
const handleLogout = async () => {
    try {
        await signOut(auth);
        window.location.replace("signout.html");
    } catch (error) {
        console.error("Logout Failed:", error.message);
        alert(`Logout Failed: ${error.message}`);
    }
};


// --- 2. AUTH STATUS CHECK & PAGE PROTECTION ---
const setupAuthProtection = () => {
    const pathname = window.location.pathname;
    const isAuthPage = pathname.includes('login.html') || pathname.includes('signup.html');
    const isSignoutPage = pathname.includes('signout.html');

    const body = document.body;
    const loader = document.getElementById('loading-overlay');

    // If no loader, we might want to hide body to prevent flash, but let's try to rely on loader if present.
    // If we hide body, we hide loader. So let's NOT hide body if loader exists.
    if (!loader) {
        body.style.visibility = 'hidden';
        body.style.opacity = '0';
    }

    // --- HEARTBEAT FUNCTION ---
    const startHeartbeat = (user) => {
        // Initial update
        const userRef = doc(db, "users", user.uid);
        updateDoc(userRef, {
            lastSeen: serverTimestamp(),
            isOnline: true
        }).catch(e => console.warn("Initial heartbeat failed", e));

        // Periodic update every 60 seconds
        setInterval(() => {
            updateDoc(userRef, {
                lastSeen: serverTimestamp(),
                isOnline: true
            }).catch(e => console.warn("Heartbeat failed", e));
        }, 60000);
    };

    // ... inside onAuthStateChanged ...

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // --- SCENARIO 1: USER IS LOGGED IN ---
            // Start Heartbeat
            startHeartbeat(user);

            try {
                await user.reload();
                // ... rest of logic

            } catch (error) {
                console.warn("Failed to reload user profile:", error);
            }

            await createUserProfileDocument(user);

            const userDocRef = doc(db, "users", user.uid);
            const userDocSnap = await getDoc(userDocRef);
            let displayUsername = user.email.split('@')[0];

            if (userDocSnap.exists()) {
                const userData = userDocSnap.data();
                if (userData.username) {
                    displayUsername = userData.username;
                }
            }

            if (isAuthPage || isSignoutPage) {
                window.location.replace("homepage.html");
            } else {
                // --- HOMEPAGE UI BLOCK START ---
                const displayNameElem = document.getElementById('user-display-name');
                const emailElem = document.getElementById('user-email');
                const photoElem = document.getElementById('user-photo');
                const logoutButton = document.getElementById('logout-button');

                if (displayNameElem) displayNameElem.textContent = displayUsername;
                if (emailElem) emailElem.textContent = user.email;
                if (photoElem && user.photoURL) {
                    photoElem.src = user.photoURL;
                    photoElem.style.display = 'block';
                }
                if (logoutButton) {
                    logoutButton.addEventListener('click', (e) => {
                        e.preventDefault();
                        handleLogout();
                    });
                }

                // Show Content / Hide Loader
                if (loader) {
                    loader.style.opacity = '0';
                    setTimeout(() => { loader.style.visibility = 'hidden'; }, 500);
                } else {
                    body.style.display = 'block';
                    body.style.visibility = 'visible';
                    body.style.opacity = '1';
                }
            }

        } else {
            // --- SCENARIO 2: USER IS NOT LOGGED IN ---
            if (!isAuthPage && !isSignoutPage) {
                window.location.replace("login.html");
            } else {
                // Show Content / Hide Loader
                if (loader) {
                    loader.style.opacity = '0';
                    setTimeout(() => { loader.style.visibility = 'hidden'; }, 500);
                } else {
                    body.style.display = 'flex'; // login page uses flex usually
                    body.style.visibility = 'visible';
                    body.style.opacity = '1';
                }
            }
        }
    });
};


// --- 3. GOOGLE SIGN-IN HANDLER ---
const handleGoogleLogin = async () => {
    try {
        await setPersistence(auth, browserLocalPersistence);
        const result = await signInWithPopup(auth, googleProvider);
        console.log("Google Sign-In Success:", result.user.email);
        // The onAuthStateChanged listener will now handle creating the user profile if it doesn't exist
        window.location.replace("homepage.html");
    } catch (error) {
        console.error("Google Login Error:", error.code, error.message);
        displayMessage(`Google Login Failed: ${error.message}`, true);
    }
};



// --- Helper function to create Toast ---
const showToast = (message, type = 'error') => {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;

    // Add close button
    const closeBtn = document.createElement('span');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.marginLeft = '10px';
    closeBtn.onclick = () => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    };
    toast.appendChild(closeBtn);

    container.appendChild(toast);

    // Auto remove
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }
    }, 4000); // 4 seconds
};

// --- Helper function to display messages (Using Toast) ---
const displayMessage = (message, isError = true) => {
    if (isError) {
        console.error(message);
        showToast(message, 'error');
    } else {
        console.log(message);
        showToast(message, 'success');
    }
}

// --- Helper function to display errors in HTML ---
const displayInPageError = (elementId, message) => {
    const errorDiv = document.getElementById(elementId);
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    } else {
        // Fallback for missing elements
        showToast(message, 'error');
    }
}

// --- Login Logic (For login.html) ---
const handleLogin = async (e) => {
    e.preventDefault();

    // UI Loading State
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.classList.add('loading-btn');

    const email = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const rememberMe = document.getElementById('login-remember').checked;

    // Reset error display
    const errorDiv = document.getElementById('login-error');
    if (errorDiv) errorDiv.style.display = 'none';

    try {
        // Enforce Local Persistence (Remember Me) by default for better UX
        // The "Remember Me" checkbox could be repurposed or removed, but for now we ignore it to fix the issue.
        await setPersistence(auth, browserLocalPersistence);

        await signInWithEmailAndPassword(auth, email, password);
        // Success handled by onAuthStateChanged
    } catch (error) {
        if (submitBtn) submitBtn.classList.remove('loading-btn'); // Reset button

        let msg = "Login Failed. Check your email and password.";
        if (error.code === 'auth/invalid-credential') {
            msg = "Invalid email or password.";
        } else if (error.code === 'auth/user-not-found') {
            msg = "User not found.";
        } else if (error.code === 'auth/wrong-password') {
            msg = "Incorrect password.";
        }
        displayInPageError('login-error', msg);
        showToast(msg, 'error'); // Also show toast for visibility
    }
};


// --- Updated Sign Up Logic (NO Firestore write here anymore) ---
const handleSignup = async (e) => {
    e.preventDefault();

    // UI Loading State
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.classList.add('loading-btn');

    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-confirm-password').value;
    const username = document.getElementById('signup-username').value;

    // Reset error display
    const errorDiv = document.getElementById('signup-error');
    if (errorDiv) errorDiv.style.display = 'none';

    if (password !== confirmPassword) {
        displayInPageError('signup-error', "Passwords do not match.");
        if (submitBtn) submitBtn.classList.remove('loading-btn');
        return;
    }

    if (password.length < 6) {
        displayInPageError('signup-error', "Password must be at least 6 characters.");
        if (submitBtn) submitBtn.classList.remove('loading-btn');
        return;
    }

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Force update the profile name in Firebase Authentication
        await updateProfile(user, { displayName: username });

        // Force create the Firestore document IMMEDIATELY with the correct name.
        // This call will pass the customUsername, ensuring it's used if the doc doesn't exist.
        await createUserProfileDocument(user, username);

        window.location.replace("homepage.html");
    } catch (error) {
        if (submitBtn) submitBtn.classList.remove('loading-btn'); // Reset button

        // If an error occurs but the user *was* created in Auth (e.g., network issue after Auth but before Firestore write)
        if (auth.currentUser) {
            console.warn("Signup error, but user created in Auth. Attempting to finalize profile:", error);
            // Ensure displayName is set if it wasn't during the initial attempt
            if (!auth.currentUser.displayName) {
                try {
                    await updateProfile(auth.currentUser, { displayName: username });
                } catch (updateError) {
                    console.warn("Failed to set displayName in signup error block:", updateError);
                }
            }
            // Now, ensure the Firestore document is created with the explicit username.
            // The modified createUserProfileDocument will use this customUsername.
            await createUserProfileDocument(auth.currentUser, username);
            window.location.replace("homepage.html");
        } else {
            // User was not created in Auth at all.
            let msg = error.message;
            if (error.code === 'auth/email-already-in-use') {
                msg = "Email is already in use.";
            } else if (error.code === 'auth/weak-password') {
                msg = "Password is too weak.";
            }
            displayInPageError('signup-error', msg);
            showToast(msg, 'error');
        }
    }
};



// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    setupAuthProtection();

    const signupForm = document.getElementById('signup-form');
    const loginForm = document.getElementById('login-form');
    const googleBtn = document.getElementById('google-login-button');
    const continueButton = document.getElementById('signout-continue-button');

    if (signupForm) signupForm.addEventListener('submit', handleSignup);
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    if (googleBtn) googleBtn.addEventListener('click', handleGoogleLogin);

    if (continueButton) {
        continueButton.addEventListener('click', () => {
            window.location.replace("login.html");
        });
    }
});