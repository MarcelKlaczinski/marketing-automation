export default {
  login: {
    title: "Sign in",
    subtitle: "Get a one-time sign-in link via email",
    emailLabel: "Email address",
    emailPlaceholder: "your@email.com",
    emailRequired: "Email address is required",
    emailInvalid: "Invalid email address",
    submitButton: "Send magic link",
    sendLink: "Send magic link",
    checkInbox: "Link sent — please check your inbox.",
    error: "Failed to send link. Please try again.",
    successMessage: "Magic link sent. Please check your inbox.",
    smtpNotConfigured:
      "Email is not configured. The sign-in link will appear in the server log (dev mode).",
    checkServerLog: "Sign-in link in server log",
    checkServerLogHint:
      'Check the console where `apps/api` is running for a block titled "🔐 Magic link". Copy the URL and paste it into your browser.',
    useDifferentEmail: "Use a different email",
  },
  verify: {
    loading: "Verifying login...",
    verifying: "Verifying link...",
    success: "Successfully signed in. Redirecting...",
    failure: "Login link invalid or expired.",
    invalid: "Login link invalid or expired.",
    noToken: "No login token found.",
    error: "Error during sign-in. Please try again.",
    backToLogin: "Back to login",
    tryAgain: "Try again",
  },
};
