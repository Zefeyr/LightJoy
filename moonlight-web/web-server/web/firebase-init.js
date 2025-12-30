// firebase-init.js

// Import necessary functions from the SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-analytics.js";
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signOut,
    GoogleAuthProvider,
    signInWithPopup,
    updateProfile
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";

// Your web app's Firebase configuration
// ⚠️ REPLACE THIS ENTIRE CONFIG OBJECT WITH YOUR REAL ONE IF IT CHANGES LATER
const firebaseConfig = {
    apiKey: "AIzaSyAb_uj1nMRWQ4eo64bGPYeOV1jWQ719nsQ",
    authDomain: "light-joy.firebaseapp.com",
    projectId: "light-joy",
    storageBucket: "light-joy.firebasestorage.app",
    messagingSenderId: "132718567982",
    appId: "1:132718567982:web:e8fad68f70f07497d475bf",
    measurementId: "G-VVEXE0HYTE"
};

// Initialize Firebase App and Analytics
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// Initialize Firebase Authentication and export the module
export const auth = getAuth(app);
export const db = getFirestore(app);   // MUST EXPORT THIS


export const googleProvider = new GoogleAuthProvider();

// Export the specific functions needed for app logic
export { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    onAuthStateChanged,
    signOut,
    signInWithPopup,
    updateProfile,
    doc,
    setDoc,
    getDoc // Added signOut for future use on index.html
};