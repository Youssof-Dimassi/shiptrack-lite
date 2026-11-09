// The page opened from the confirmation email.
//
// Opening a link must not change anything, because email security scanners
// open links automatically. Confirming only happens in this POST request.

const confirmTitle = document.querySelector("#confirm-title");
const confirmText = document.querySelector("#confirm-text");

async function confirmEmail() {
  const token = new URLSearchParams(window.location.search).get("token");

  try {
    const response = await fetch("/api/auth/confirm-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await response.json();

    confirmTitle.textContent = response.ok ? "Email confirmed" : "Link not valid";
    confirmText.textContent = response.ok ? data.message : `${data.error} You can request a new one from My shipments.`;
  } catch {
    confirmTitle.textContent = "Something went wrong";
    confirmText.textContent = "Could not reach the server. Please try the link again.";
  }
}

confirmEmail();
