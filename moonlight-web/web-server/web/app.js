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
    getDoc // <-- Import getDoc here
} from './firebase-init.js';


// --- Function to create or verify user document in Firestore ---
const createUserProfileDocument = async (user, customUsername = null) => {
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
            const usernameToSet = customUsername || user.displayName || user.email.split('@')[0];
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
    body.style.visibility = 'hidden';
    body.style.opacity = '0';

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // --- SCENARIO 1: USER IS LOGGED IN ---

            // Keep user.reload() here for general robustness.
            // It helps ensure that for existing users or Google Sign-In,
            // the user.displayName is current if createUserProfileDocument
            // needs to use it as a fallback.
            try {
                await user.reload();
            } catch (error) {
                console.warn("Failed to reload user profile:", error);
                // Continue execution even if reload fails.
            }

            // Now, call the function to create/verify the user's Firestore document.
            // This call *will not* have customUsername. The modified createUserProfileDocument
            // will check if the doc exists and, if so, will not overwrite the username.
            await createUserProfileDocument(user);

            // Fetch the username directly from Firestore for display purposes.
            // This ensures we always get the definitive username from your database.
            const userDocRef = doc(db, "users", user.uid);
            const userDocSnap = await getDoc(userDocRef);
            let displayUsername = user.email.split('@')[0]; // Default fallback if nothing else is found

            if (userDocSnap.exists()) {
                const userData = userDocSnap.data();
                if (userData.username) {
                    displayUsername = userData.username;
                }
            } else {
                console.warn("Firestore user document not found for display after creation attempt for UID:", user.uid);
            }

            if (isAuthPage || isSignoutPage) {
                window.location.replace("homepage.html");
            } else {
                // --- HOMEPAGE UI BLOCK START ---

                const displayNameElem = document.getElementById('user-display-name');
                const emailElem = document.getElementById('user-email');
                const photoElem = document.getElementById('user-photo');
                const logoutButton = document.getElementById('logout-button');

                // Use the fetched displayUsername from Firestore for rendering
                if (displayNameElem) {
                    displayNameElem.textContent = displayUsername;
                }

                if (emailElem) {
                    emailElem.textContent = user.email;
                }

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

                body.style.display = 'block';
                body.style.visibility = 'visible';
                body.style.opacity = '1';

                // --- HOMEPAGE UI BLOCK END ---
            }

        } else {
            // --- SCENARIO 2: USER IS NOT LOGGED IN ---

            if (!isAuthPage && !isSignoutPage) {
                window.location.replace("login.html");
            } else {
                body.style.display = 'flex';
                body.style.visibility = 'visible';
                body.style.opacity = '1';
            }
        }
    });
};


// --- 3. GOOGLE SIGN-IN HANDLER ---
const handleGoogleLogin = async () => {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        console.log("Google Sign-In Success:", result.user.email);
        // The onAuthStateChanged listener will now handle creating the user profile if it doesn't exist
        window.location.replace("homepage.html");
    } catch (error) {
        console.error("Google Login Error:", error.code, error.message);
        displayMessage(`Google Login Failed: ${error.message}`, true);
    }
};


// --- Helper function to display messages ---
const displayMessage = (message, isError = true) => {
    if (isError) {
        console.error(message);
        alert(`Error: ${message}`);
    } else {
        console.log(message);
        alert(`Success: ${message}`);
    }
}

// --- Login Logic (For login.html) ---
const handleLogin = (e) => {
    e.preventDefault();
    const email = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    signInWithEmailAndPassword(auth, email, password)
        .catch((error) => {
            displayMessage(`Login Failed: ${error.message}`, true);
        });
};


// --- Updated Sign Up Logic (NO Firestore write here anymore) ---
const handleSignup = async (e) => {
    e.preventDefault();
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const username = document.getElementById('signup-username').value;

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
            displayMessage(`Signup Failed: ${error.message}`, true);
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