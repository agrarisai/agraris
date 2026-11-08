// Follow by email: formulir di beranda + halaman konfirmasi/berhenti
// (follow.html?a=confirm|unsub&t=<token>). Hanya email yang dikirim;
// konfirmasi dan berhenti memakai token acak dari email.
(function () {
  "use strict";

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  function $(id) { return document.getElementById(id); }

  // ---------- formulir di beranda ----------
  var form = $("follow-form");
  if (form) {
    var input = $("follow-email");
    var msg = $("follow-msg");
    var btn = form.querySelector("button[type=submit]");

    function say(text, ok) {
      msg.textContent = text;
      msg.className = "follow-msg " + (ok ? "is-ok" : "is-error");
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = (input.value || "").trim().toLowerCase();
      if (!EMAIL.test(email) || email.length > 254) {
        say("Please enter a valid email address.", false);
        return;
      }
      btn.disabled = true;
      supabaseClient
        .rpc("subscribe_email", { p_email: email })
        .then(function (res) {
          btn.disabled = false;
          if (res.error) {
            say(
              /busy/.test(res.error.message || "")
                ? "We're a bit busy right now. Please try again in a few minutes."
                : "That didn't work. Please check the address and try again.",
              false
            );
            return;
          }
          input.value = "";
          say("Check your inbox for a confirmation link. It can take a few minutes.", true);
        })
        .catch(function () {
          btn.disabled = false;
          say("That didn't work. Please try again.", false);
        });
    });
  }

  // ---------- halaman follow.html ----------
  var title = $("follow-title");
  if (title) {
    var params = new URLSearchParams(location.search);
    var action = params.get("a");
    var token = params.get("t") || "";
    var text = $("follow-text");

    function show(t, p) { title.textContent = t; text.textContent = p; }

    if ((action !== "confirm" && action !== "unsub") || !UUID.test(token)) {
      show("This link isn't valid", "Open the link from your email again, or subscribe from the home page.");
    } else {
      var fn = action === "confirm" ? "confirm_subscription" : "unsubscribe_email";
      supabaseClient
        .rpc(fn, { p_token: token })
        .then(function (res) {
          if (res.error || res.data !== true) {
            show(
              "We couldn't find that subscription",
              action === "confirm"
                ? "The link may have expired. Subscribe again from the home page."
                : "It may already be removed."
            );
            return;
          }
          if (action === "confirm") {
            show("You're subscribed", "One email a week with new listings and the most active agents. You can unsubscribe from any email.");
          } else {
            show("You're unsubscribed", "No more emails from us. You can subscribe again any time from the home page.");
          }
        })
        .catch(function () {
          show("Something went wrong", "Please try again in a moment.");
        });
    }
  }
})();
