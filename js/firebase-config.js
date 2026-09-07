import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";

import { getFirestore }
from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

import {getAuth}
from"https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";

import { getStorage }
from "https://www.gstatic.com/firebasejs/11.9.1/firebase-storage.js";


const firebaseConfig = {

apiKey: "AIzaSyDSqC6seQoMsM1jMKGe5DTHf0NpmwFRLuo",

authDomain:
"kusk-network-manager.firebaseapp.com",

projectId:
"kusk-network-manager",

storageBucket:
"kusk-network-manager.firebasestorage.app",

messagingSenderId:
"335878474446",

appId:
"1:335878474446:web:dc9b7051ee1082fc3b1e9f"

};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth =getAuth(app);
export const storage = getStorage(app);