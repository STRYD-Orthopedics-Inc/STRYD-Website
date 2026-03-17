/* =============================================
   STRYD Orthopedics — Main JavaScript

   Handles:
   1. Navbar — adds frosted-glass background on scroll
   2. Active nav link — highlights current section in nav
   3. Mobile nav — hamburger toggle + overlay
   4. Smooth scroll — anchor links scroll with offset for fixed nav
   5. Scroll reveal — fade-in animation as sections enter viewport
   6. Forms — waitlist + contact submit with success states
   ============================================= */

// Netlify Forms handles submissions automatically via data-netlify attribute.
// No external webhook needed — submissions appear in Netlify dashboard.

// Validate email format
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Rate limiting — block resubmission within 5 seconds
let lastSubmitTime = 0;
function isRateLimited() {
    const now = Date.now();
    if (now - lastSubmitTime < 5000) return true;
    lastSubmitTime = now;
    return false;
}

// Allowed roles for contact form
const VALID_ROLES = ['clinician', 'patient', 'investor', 'partner', 'researcher', 'other'];

document.addEventListener('DOMContentLoaded', () => {

    /* -----------------------------------------
       1. NAVBAR SCROLL EFFECT
       Adds .scrolled class when page is scrolled
       past 50px, triggering the blur/bg in CSS.
       ----------------------------------------- */
    const navbar = document.getElementById('navbar');
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('section[id]');

    function handleNavScroll() {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    }

    /* -----------------------------------------
       2. ACTIVE NAV LINK ON SCROLL
       Checks which section is in the top third
       of the viewport and highlights its nav link.
       ----------------------------------------- */
    function updateActiveNav() {
        const scrollPos = window.scrollY + window.innerHeight / 3;

        sections.forEach(section => {
            const top = section.offsetTop;
            const height = section.offsetHeight;
            const id = section.getAttribute('id');

            if (scrollPos >= top && scrollPos < top + height) {
                navLinks.forEach(link => {
                    link.classList.remove('active');
                    if (link.getAttribute('href') === `#${id}`) {
                        link.classList.add('active');
                    }
                });
            }
        });
    }

    // Listen for scroll — passive: true for performance (no preventDefault needed)
    window.addEventListener('scroll', () => {
        handleNavScroll();
        updateActiveNav();
    }, { passive: true });

    /* -----------------------------------------
       3. MOBILE NAVIGATION
       Creates a dark overlay behind the slide-out
       menu. Toggle opens/closes the menu + overlay
       and locks body scroll when open.
       ----------------------------------------- */
    const navToggle = document.getElementById('navToggle');
    const navLinksContainer = document.getElementById('navLinks');

    // Create overlay element and add to DOM
    let overlay = document.createElement('div');
    overlay.classList.add('nav-overlay');
    document.body.appendChild(overlay);

    function toggleMobileNav() {
        navToggle.classList.toggle('active');       // Animates hamburger → X
        navLinksContainer.classList.toggle('open');  // Slides menu in from right
        overlay.classList.toggle('active');          // Shows dark backdrop
        // Lock body scroll when menu is open
        document.body.style.overflow = navLinksContainer.classList.contains('open') ? 'hidden' : '';
    }

    function closeMobileNav() {
        navToggle.classList.remove('active');
        navLinksContainer.classList.remove('open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    navToggle.addEventListener('click', toggleMobileNav);
    overlay.addEventListener('click', closeMobileNav);   // Clicking backdrop closes menu

    // Close menu when a nav link is clicked (user navigated)
    navLinksContainer.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', closeMobileNav);
    });

    /* -----------------------------------------
       4. SMOOTH SCROLL FOR ANCHOR LINKS
       Intercepts all # links, calculates target
       position minus navbar height, and scrolls
       smoothly to that position.
       ----------------------------------------- */
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = anchor.getAttribute('href');
            const target = document.querySelector(targetId);
            if (target) {
                const offset = navbar.offsetHeight;  // Account for fixed nav
                const top = target.getBoundingClientRect().top + window.scrollY - offset;
                window.scrollTo({
                    top: top,
                    behavior: 'smooth'
                });
            }
        });
    });

    /* -----------------------------------------
       5. SCROLL REVEAL ANIMATION
       Adds .reveal class (opacity:0, translateY)
       to key elements. IntersectionObserver adds
       .visible when they scroll into view, which
       triggers the CSS transition. Each element
       gets a staggered delay (1-4) for cascade.
       ----------------------------------------- */
    function initRevealAnimations() {
        // Select all elements that should animate on scroll
        const revealElements = document.querySelectorAll(
            '.section-header, .tech-card, .gallery-item, .feature, .contact-info, .contact-form-wrapper, .waitlist-content, .hero-content, .hero-image, .product-main-image'
        );

        // Add reveal + staggered delay classes
        revealElements.forEach((el, index) => {
            el.classList.add('reveal');
            const delayClass = `reveal-delay-${(index % 4) + 1}`;
            el.classList.add(delayClass);
        });

        // Observe: trigger .visible when 10% of element is in view
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    observer.unobserve(entry.target); // Only animate once
                }
            });
        }, {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px' // Trigger slightly before fully in view
        });

        revealElements.forEach(el => observer.observe(el));
    }

    initRevealAnimations();

    /* -----------------------------------------
       6A. WAITLIST FORM
       Sends email to Google Sheet via Apps Script
       ----------------------------------------- */
    const waitlistForm = document.getElementById('waitlistForm');
    if (waitlistForm) {
        waitlistForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('waitlistEmail').value.trim();
            const btn = waitlistForm.querySelector('button[type="submit"]');
            const originalText = btn.textContent;

            // Remove any previous error
            waitlistForm.querySelector('.form-error')?.remove();

            // Honeypot check — bots fill hidden fields
            const hp = waitlistForm.querySelector('.hp-field');
            if (hp && hp.value) {
                waitlistForm.innerHTML = `
                    <div class="form-success">
                        <div class="success-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                        </div>
                        <h3>You're on the list!</h3>
                        <p>We'll reach out when early access is available.</p>
                    </div>
                `;
                return;
            }

            // Validation
            if (!isValidEmail(email)) {
                const err = document.createElement('p');
                err.className = 'form-error';
                err.textContent = 'Please enter a valid email address.';
                waitlistForm.appendChild(err);
                return;
            }
            if (email.length > 254) {
                const err = document.createElement('p');
                err.className = 'form-error';
                err.textContent = 'Email address is too long.';
                waitlistForm.appendChild(err);
                return;
            }

            // Rate limiting
            if (isRateLimited()) {
                const err = document.createElement('p');
                err.className = 'form-error';
                err.textContent = 'Please wait a few seconds before submitting again.';
                waitlistForm.appendChild(err);
                return;
            }

            // Loading state
            btn.textContent = 'Submitting...';
            btn.classList.add('btn-loading');
            btn.disabled = true;

            try {
                const formData = new FormData(waitlistForm);
                const res = await fetch('/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams(formData).toString()
                });
                if (!res.ok) throw new Error('Submission failed');

                // Replace form with success confirmation
                waitlistForm.innerHTML = `
                    <div class="form-success">
                        <div class="success-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                        </div>
                        <h3>You're on the list!</h3>
                        <p>We'll reach out when early access is available.</p>
                    </div>
                `;
            } catch (err) {
                btn.textContent = originalText;
                btn.classList.remove('btn-loading');
                btn.disabled = false;
                const errorEl = document.createElement('p');
                errorEl.className = 'form-error';
                errorEl.textContent = 'Something went wrong. Please try again.';
                waitlistForm.appendChild(errorEl);
            }
        });
    }

    /* -----------------------------------------
       6B. CONTACT FORM
       Sends all fields to Google Sheet via Apps Script
       ----------------------------------------- */
    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = contactForm.querySelector('button[type="submit"]');
            const originalText = btn.textContent;

            // Remove any previous error
            contactForm.querySelector('.form-error')?.remove();

            // Honeypot check
            const hp = contactForm.querySelector('.hp-field');
            if (hp && hp.value) {
                const wrapper = document.querySelector('.contact-form-wrapper');
                wrapper.innerHTML = `
                    <div class="form-success">
                        <div class="success-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                        </div>
                        <h3>Message Sent!</h3>
                        <p>Thank you for reaching out. We'll get back to you shortly.</p>
                    </div>
                `;
                return;
            }

            // Gather raw values
            const firstName = document.getElementById('firstName').value.trim();
            const lastName = document.getElementById('lastName').value.trim();
            const email = document.getElementById('email').value.trim();
            const phone = document.getElementById('phone').value.trim();
            const company = document.getElementById('company').value.trim();
            const role = document.getElementById('role').value;
            const message = document.getElementById('message').value.trim();

            // Validation
            const errors = [];
            if (firstName.length > 100) errors.push('First name is too long (max 100 characters).');
            if (lastName.length > 100) errors.push('Last name is too long (max 100 characters).');
            if (!isValidEmail(email)) errors.push('Please enter a valid email address.');
            if (email.length > 254) errors.push('Email address is too long.');
            if (phone && !/^[\d\s\+\-().]{7,20}$/.test(phone)) errors.push('Please enter a valid phone number.');
            if (company.length > 100) errors.push('Company name is too long (max 100 characters).');
            if (!VALID_ROLES.includes(role)) errors.push('Please select a valid role.');
            if (message.length > 2000) errors.push('Message is too long (max 2000 characters).');

            if (errors.length) {
                const err = document.createElement('p');
                err.className = 'form-error';
                err.textContent = errors[0];
                contactForm.appendChild(err);
                return;
            }

            // Rate limiting
            if (isRateLimited()) {
                const err = document.createElement('p');
                err.className = 'form-error';
                err.textContent = 'Please wait a few seconds before submitting again.';
                contactForm.appendChild(err);
                return;
            }

            // Loading state
            btn.textContent = 'Sending...';
            btn.classList.add('btn-loading');
            btn.disabled = true;

            try {
                const netlifyData = new FormData(contactForm);
                const res = await fetch('/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams(netlifyData).toString()
                });
                if (!res.ok) throw new Error('Submission failed');

                // Replace form wrapper with success confirmation
                const wrapper = document.querySelector('.contact-form-wrapper');
                wrapper.innerHTML = `
                    <div class="form-success">
                        <div class="success-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                        </div>
                        <h3>Message Sent!</h3>
                        <p>Thank you for reaching out. We'll get back to you shortly.</p>
                    </div>
                `;
            } catch (err) {
                btn.textContent = originalText;
                btn.classList.remove('btn-loading');
                btn.disabled = false;
                const errorEl = document.createElement('p');
                errorEl.className = 'form-error';
                errorEl.textContent = 'Something went wrong. Please try again.';
                contactForm.appendChild(errorEl);
            }
        });
    }

    /* -----------------------------------------
       KEYBOARD ACCESSIBILITY
       Escape key closes the mobile nav menu.
       ----------------------------------------- */
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeMobileNav();
        }
    });

    /* -----------------------------------------
       INITIALIZE — run on page load
       ----------------------------------------- */
    handleNavScroll();
    updateActiveNav();

});
