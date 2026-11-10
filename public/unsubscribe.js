// The page opened from the "stop these emails" link.
//
// Like email confirmation, opening the link changes nothing by itself, because
// email scanners open links automatically. This page sends the request.

const unsubscribeTitle = document.querySelector("#unsubscribe-title");
const unsubscribeText = document.querySelector("#unsubscribe-text");

async function unsubscribe() {
  const token = new URLSearchParams(window.location.search).get("token");

  try {
    const response = await fetch("/api/notifications/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await response.json();

    unsubscribeTitle.textContent = response.ok ? "You're unsubscribed" : "Link not valid";
    unsubscribeText.textContent = response.ok
      ? `${data.message} You can turn them back on in My shipments.`
      : `${data.error} You can change this setting in My shipments.`;
  } catch {
    unsubscribeTitle.textContent = "Something went wrong";
    unsubscribeText.textContent = "Could not reach the server. Please try the link again.";
  }
}

unsubscribe();
