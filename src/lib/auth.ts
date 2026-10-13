import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { auth } from './firebase';

function requireAuth() {
  if (!auth) throw new Error('firebase-not-configured');
  return auth;
}

export async function registerWithEmail(email: string, password: string) {
  const userCredential = await createUserWithEmailAndPassword(
    requireAuth(),
    email.trim(),
    password,
  );
  await sendEmailVerification(userCredential.user);
  return userCredential.user;
}

export async function signInWithEmail(email: string, password: string) {
  const userCredential = await signInWithEmailAndPassword(
    requireAuth(),
    email.trim(),
    password,
  );
  return userCredential.user;
}

export async function signOutAccount() {
  await signOut(requireAuth());
}
