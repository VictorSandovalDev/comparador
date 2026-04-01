import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAbSuqCJIe0RyxGHEhbYwea5C_9O-VFuCE",
  authDomain: "comparador-7c5d8.firebaseapp.com",
  projectId: "comparador-7c5d8",
  storageBucket: "comparador-7c5d8.firebasestorage.app",
  messagingSenderId: "985245329471",
  appId: "1:985245329471:web:20775e7f7bed3cf360308a",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
