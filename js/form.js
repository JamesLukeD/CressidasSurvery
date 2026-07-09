/* global fetch */
"use strict";

(function () {
  // ============================================================
  // DOM references
  // ============================================================
  const form = document.getElementById("registration-form");
  const submitBtn = document.getElementById("submit-btn");
  const btnText = submitBtn.querySelector(".btn-text");
  const btnSpinner = submitBtn.querySelector(".btn-spinner");
  const successPanel = document.getElementById("success-message");
  const successDetail = document.getElementById("success-details");
  const errorBanner = document.getElementById("error-banner");
  const errorBannerMsg = document.getElementById("error-banner-message");

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Returns the current value of a named form element.
   * Handles text inputs, selects, textareas, checkboxes, and radio groups.
   */
  function getFieldValue(name) {
    var el = form.elements[name];
    if (!el) return "";
    // RadioNodeList (radio groups)
    if (
      typeof el.value !== "undefined" &&
      el.length !== undefined &&
      el[0] instanceof HTMLInputElement &&
      el[0].type === "radio"
    ) {
      return el.value; // returns value of checked radio, or '' if none
    }
    if (el.type === "checkbox") return el.checked;
    return el.value.trim();
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  }

  function isValidPhone(phone) {
    return /^[\d\s+\-()\[\]]{7,20}$/.test(phone);
  }

  // ============================================================
  // Error / state management
  // ============================================================

  function showFieldError(fieldId, message) {
    var errorEl = document.getElementById(fieldId + "-error");
    var groupEl = document.getElementById("group-" + fieldId);
    if (errorEl) errorEl.textContent = message;
    if (groupEl) groupEl.classList.add("has-error");
  }

  function clearFieldError(fieldId) {
    var errorEl = document.getElementById(fieldId + "-error");
    var groupEl = document.getElementById("group-" + fieldId);
    if (errorEl) errorEl.textContent = "";
    if (groupEl) groupEl.classList.remove("has-error");
  }

  function clearAllFieldErrors() {
    var fields = [
      "fullName",
      "email",
      "contactPhoneNumber",
      "trustOrganisation",
      "professionRole",
      "placeOfWork",
      "preferredSessionDate",
      "willingToBeContacted",
      "gdprConsent",
    ];
    fields.forEach(clearFieldError);
  }

  function showBanner(message) {
    errorBannerMsg.textContent = message;
    errorBanner.hidden = false;
    errorBanner.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function clearBanner() {
    errorBannerMsg.textContent = "";
    errorBanner.hidden = true;
  }

  function setSubmitting(active) {
    submitBtn.disabled = active;
    submitBtn.setAttribute("aria-busy", active ? "true" : "false");
    btnText.textContent = active ? "Submitting\u2026" : "Register for Session";
    btnSpinner.hidden = !active;
  }

  // ============================================================
  // Client-side validation
  // ============================================================

  function validate() {
    var isValid = true;
    clearAllFieldErrors();

    // Full name
    var fullName = getFieldValue("fullName");
    if (!fullName || fullName.length < 2) {
      showFieldError("fullName", "Please enter your full name.");
      isValid = false;
    }

    // Email
    var email = getFieldValue("email");
    if (!email) {
      showFieldError("email", "Please enter your email address.");
      isValid = false;
    } else if (!isValidEmail(email)) {
      showFieldError(
        "email",
        "Please enter a valid email address (e.g. name@nhs.net).",
      );
      isValid = false;
    }

    // Phone (optional, validate if provided)
    var phone = getFieldValue("contactPhoneNumber");
    if (phone && !isValidPhone(phone)) {
      showFieldError(
        "contactPhoneNumber",
        "Please enter a valid phone number.",
      );
      isValid = false;
    }

    // Trust
    var trust = getFieldValue("trustOrganisation");
    if (!trust) {
      showFieldError(
        "trustOrganisation",
        "Please select your trust or organisation.",
      );
      isValid = false;
    }

    // Profession
    var profession = getFieldValue("professionRole");
    if (!profession) {
      showFieldError(
        "professionRole",
        "Please select your profession or role.",
      );
      isValid = false;
    }

    // Place of work
    var place = getFieldValue("placeOfWork");
    if (!place) {
      showFieldError("placeOfWork", "Please enter your place of work.");
      isValid = false;
    }

    // Session date
    var date = getFieldValue("preferredSessionDate");
    if (!date) {
      showFieldError(
        "preferredSessionDate",
        "Please select a preferred session date.",
      );
      isValid = false;
    }

    // Willing to be contacted
    var willing = getFieldValue("willingToBeContacted");
    if (!willing) {
      showFieldError(
        "willingToBeContacted",
        "Please indicate whether you are willing to be contacted for further education.",
      );
      isValid = false;
    }

    // GDPR consent
    var consent = getFieldValue("gdprConsent");
    if (!consent) {
      showFieldError(
        "gdprConsent",
        "You must consent to data processing to complete your registration.",
      );
      isValid = false;
    }

    return isValid;
  }

  // ============================================================
  // Form submission
  // ============================================================

  function handleSubmit(event) {
    event.preventDefault();
    clearBanner();

    if (!validate()) {
      // Move focus to first error field
      var firstErrorField = form.querySelector(
        ".has-error input, .has-error select, .has-error textarea",
      );
      if (firstErrorField) {
        firstErrorField.focus();
      }
      showBanner(
        "Please correct the highlighted errors below before submitting.",
      );
      return;
    }

    setSubmitting(true);

    var honeypotEl = form.querySelector('[name="honeypot"]');

    var payload = {
      fullName: getFieldValue("fullName"),
      email: getFieldValue("email"),
      trustOrganisation: getFieldValue("trustOrganisation"),
      professionRole: getFieldValue("professionRole"),
      departmentSpecialty: getFieldValue("departmentSpecialty") || undefined,
      placeOfWork: getFieldValue("placeOfWork"),
      preferredSessionDate: getFieldValue("preferredSessionDate"),
      willingToBeContacted: getFieldValue("willingToBeContacted") === "true",
      contactPhoneNumber: getFieldValue("contactPhoneNumber") || undefined,
      howDidYouHear: getFieldValue("howDidYouHear") || undefined,
      gdprConsent: true,
      honeypot: honeypotEl ? honeypotEl.value : "",
    };

    fetch("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (response) {
        return response
          .json()
          .then(function (data) {
            return { status: response.status, data: data };
          })
          .catch(function () {
            return { status: response.status, data: {} };
          });
      })
      .then(function (result) {
        var status = result.status;
        var data = result.data;

        if (status >= 200 && status < 300 && data.success) {
          form.hidden = true;
          var dateLabel = data.sessionDate || "your selected date";
          successDetail.textContent =
            "Thank you for registering. Your place has been reserved for " +
            dateLabel +
            ". A confirmation email has been sent to " +
            payload.email +
            " with your session details and joining link.";
          successPanel.hidden = false;
          successPanel.focus();
          successPanel.scrollIntoView({ behavior: "smooth", block: "start" });
        } else if (status === 409) {
          setSubmitting(false);
          showBanner(
            data.message ||
              "It looks like you have already registered for this session with this email address. If you believe this is an error, please contact the education team.",
          );
        } else if (status === 400 && data.errors && data.errors.length) {
          setSubmitting(false);
          showBanner("Please correct the following: " + data.errors.join("; "));
        } else if (status === 429) {
          setSubmitting(false);
          showBanner(
            "Too many requests. Please wait a few minutes before trying again.",
          );
        } else {
          setSubmitting(false);
          showBanner(
            (data && data.message) ||
              "An error occurred while processing your registration. Please try again or contact the education team if the problem persists.",
          );
        }
      })
      .catch(function () {
        setSubmitting(false);
        showBanner(
          "Unable to submit the form. Please check your internet connection and try again.",
        );
      });
  }

  // ============================================================
  // Inline validation on blur (progressive enhancement)
  // ============================================================

  form.addEventListener(
    "blur",
    function (event) {
      var target = event.target;
      if (!target || !target.name) return;
      var name = target.name;

      switch (name) {
        case "fullName": {
          var val = target.value.trim();
          clearFieldError("fullName");
          if (val.length > 0 && val.length < 2) {
            showFieldError("fullName", "Please enter your full name.");
          }
          break;
        }
        case "email": {
          var emailVal = target.value.trim();
          clearFieldError("email");
          if (emailVal.length > 0 && !isValidEmail(emailVal)) {
            showFieldError("email", "Please enter a valid email address.");
          }
          break;
        }
        case "contactPhoneNumber": {
          var phoneVal = target.value.trim();
          clearFieldError("contactPhoneNumber");
          if (phoneVal.length > 0 && !isValidPhone(phoneVal)) {
            showFieldError(
              "contactPhoneNumber",
              "Please enter a valid phone number.",
            );
          }
          break;
        }
      }
    },
    true,
  ); // capture phase — needed because blur doesn't bubble

  // ============================================================
  // Initialise
  // ============================================================

  form.addEventListener("submit", handleSubmit);
})();
