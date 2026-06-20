const signUpForm = document.getElementById("sign-up-form");
const signUpError = document.getElementById("sign-up-error");
const signUpSuccess = document.getElementById("sign-up-success");
const signUpButton = document.getElementById("sign-up-button");
const countryCodeSelect = document.getElementById("country-code");
const countryResidenceSelect = document.getElementById("country-residence");
const termsModal = document.getElementById("terms-modal");
const openTermsButton = document.getElementById("open-terms-button");

const countryCallingCodes = `
AF|+93|Afghanistan
AL|+355|Albania
DZ|+213|Algeria
AS|+1-684|American Samoa
AD|+376|Andorra
AO|+244|Angola
AI|+1-264|Anguilla
AG|+1-268|Antigua and Barbuda
AR|+54|Argentina
AM|+374|Armenia
AW|+297|Aruba
AU|+61|Australia
AT|+43|Austria
AZ|+994|Azerbaijan
BS|+1-242|Bahamas
BH|+973|Bahrain
BD|+880|Bangladesh
BB|+1-246|Barbados
BY|+375|Belarus
BE|+32|Belgium
BZ|+501|Belize
BJ|+229|Benin
BM|+1-441|Bermuda
BT|+975|Bhutan
BO|+591|Bolivia
BA|+387|Bosnia and Herzegovina
BW|+267|Botswana
BR|+55|Brazil
IO|+246|British Indian Ocean Territory
VG|+1-284|British Virgin Islands
BN|+673|Brunei
BG|+359|Bulgaria
BF|+226|Burkina Faso
BI|+257|Burundi
KH|+855|Cambodia
CM|+237|Cameroon
CA|+1|Canada
CV|+238|Cape Verde
KY|+1-345|Cayman Islands
CF|+236|Central African Republic
TD|+235|Chad
CL|+56|Chile
CN|+86|China
CX|+61|Christmas Island
CC|+61|Cocos Islands
CO|+57|Colombia
KM|+269|Comoros
CK|+682|Cook Islands
CR|+506|Costa Rica
CI|+225|Cote d'Ivoire
HR|+385|Croatia
CU|+53|Cuba
CW|+599|Curacao
CY|+357|Cyprus
CZ|+420|Czech Republic
CD|+243|Democratic Republic of the Congo
DK|+45|Denmark
DJ|+253|Djibouti
DM|+1-767|Dominica
DO|+1-809|Dominican Republic
TL|+670|East Timor
EC|+593|Ecuador
EG|+20|Egypt
SV|+503|El Salvador
GQ|+240|Equatorial Guinea
ER|+291|Eritrea
EE|+372|Estonia
SZ|+268|Eswatini
ET|+251|Ethiopia
FK|+500|Falkland Islands
FO|+298|Faroe Islands
FJ|+679|Fiji
FI|+358|Finland
FR|+33|France
GF|+594|French Guiana
PF|+689|French Polynesia
GA|+241|Gabon
GM|+220|Gambia
GE|+995|Georgia
DE|+49|Germany
GH|+233|Ghana
GI|+350|Gibraltar
GR|+30|Greece
GL|+299|Greenland
GD|+1-473|Grenada
GP|+590|Guadeloupe
GU|+1-671|Guam
GT|+502|Guatemala
GG|+44|Guernsey
GN|+224|Guinea
GW|+245|Guinea-Bissau
GY|+592|Guyana
HT|+509|Haiti
HN|+504|Honduras
HK|+852|Hong Kong
HU|+36|Hungary
IS|+354|Iceland
IN|+91|India
ID|+62|Indonesia
IR|+98|Iran
IQ|+964|Iraq
IE|+353|Ireland
IM|+44|Isle of Man
IL|+972|Israel
IT|+39|Italy
JM|+1-876|Jamaica
JP|+81|Japan
JE|+44|Jersey
JO|+962|Jordan
KZ|+7|Kazakhstan
KE|+254|Kenya
KI|+686|Kiribati
XK|+383|Kosovo
KW|+965|Kuwait
KG|+996|Kyrgyzstan
LA|+856|Laos
LV|+371|Latvia
LB|+961|Lebanon
LS|+266|Lesotho
LR|+231|Liberia
LY|+218|Libya
LI|+423|Liechtenstein
LT|+370|Lithuania
LU|+352|Luxembourg
MO|+853|Macau
MG|+261|Madagascar
MW|+265|Malawi
MY|+60|Malaysia
MV|+960|Maldives
ML|+223|Mali
MT|+356|Malta
MH|+692|Marshall Islands
MQ|+596|Martinique
MR|+222|Mauritania
MU|+230|Mauritius
YT|+262|Mayotte
MX|+52|Mexico
FM|+691|Micronesia
MD|+373|Moldova
MC|+377|Monaco
MN|+976|Mongolia
ME|+382|Montenegro
MS|+1-664|Montserrat
MA|+212|Morocco
MZ|+258|Mozambique
MM|+95|Myanmar
NA|+264|Namibia
NR|+674|Nauru
NP|+977|Nepal
NL|+31|Netherlands
NC|+687|New Caledonia
NZ|+64|New Zealand
NI|+505|Nicaragua
NE|+227|Niger
NG|+234|Nigeria
NU|+683|Niue
NF|+672|Norfolk Island
KP|+850|North Korea
MK|+389|North Macedonia
MP|+1-670|Northern Mariana Islands
NO|+47|Norway
OM|+968|Oman
PK|+92|Pakistan
PW|+680|Palau
PS|+970|Palestine
PA|+507|Panama
PG|+675|Papua New Guinea
PY|+595|Paraguay
PE|+51|Peru
PH|+63|Philippines
PL|+48|Poland
PT|+351|Portugal
PR|+1-787|Puerto Rico
QA|+974|Qatar
CG|+242|Republic of the Congo
RE|+262|Reunion
RO|+40|Romania
RU|+7|Russia
RW|+250|Rwanda
BL|+590|Saint Barthelemy
SH|+290|Saint Helena
KN|+1-869|Saint Kitts and Nevis
LC|+1-758|Saint Lucia
MF|+590|Saint Martin
PM|+508|Saint Pierre and Miquelon
VC|+1-784|Saint Vincent and the Grenadines
WS|+685|Samoa
SM|+378|San Marino
ST|+239|Sao Tome and Principe
SA|+966|Saudi Arabia
SN|+221|Senegal
RS|+381|Serbia
SC|+248|Seychelles
SL|+232|Sierra Leone
SG|+65|Singapore
SX|+1-721|Sint Maarten
SK|+421|Slovakia
SI|+386|Slovenia
SB|+677|Solomon Islands
SO|+252|Somalia
ZA|+27|South Africa
KR|+82|South Korea
SS|+211|South Sudan
ES|+34|Spain
LK|+94|Sri Lanka
SD|+249|Sudan
SR|+597|Suriname
SJ|+47|Svalbard and Jan Mayen
SE|+46|Sweden
CH|+41|Switzerland
SY|+963|Syria
TW|+886|Taiwan
TJ|+992|Tajikistan
TZ|+255|Tanzania
TH|+66|Thailand
TG|+228|Togo
TK|+690|Tokelau
TO|+676|Tonga
TT|+1-868|Trinidad and Tobago
TN|+216|Tunisia
TR|+90|Turkey
TM|+993|Turkmenistan
TC|+1-649|Turks and Caicos Islands
TV|+688|Tuvalu
VI|+1-340|U.S. Virgin Islands
UG|+256|Uganda
UA|+380|Ukraine
AE|+971|United Arab Emirates
GB|+44|United Kingdom
US|+1|United States
UY|+598|Uruguay
UZ|+998|Uzbekistan
VU|+678|Vanuatu
VA|+379|Vatican City
VE|+58|Venezuela
VN|+84|Vietnam
WF|+681|Wallis and Futuna
EH|+212|Western Sahara
YE|+967|Yemen
ZM|+260|Zambia
ZW|+263|Zimbabwe
`.trim().split("\n").map((row) => row.split("|"));

function populateCountryCodes() {
  if (countryCodeSelect) {
    countryCodeSelect.innerHTML = countryCallingCodes
      .map(([iso, code, country]) => `<option value="${code}" title="${country}" ${iso === "US" ? "selected" : ""}>${iso} ${code}</option>`)
      .join("");
  }

  if (countryResidenceSelect) {
    countryResidenceSelect.innerHTML = countryCallingCodes
      .map(([iso, , country]) => `<option value="${country}" ${iso === "US" ? "selected" : ""}>${country}</option>`)
      .join("");
  }
}

function setSignUpMessage(type, message) {
  const target = type === "success" ? signUpSuccess : signUpError;
  const other = type === "success" ? signUpError : signUpSuccess;
  if (other) {
    other.textContent = "";
    other.hidden = true;
  }
  if (!target) return;
  target.textContent = message || "";
  target.hidden = !message;
}

function signUpNextPage() {
  const params = new URLSearchParams(location.search);
  const next = params.get("next") || "account.html";
  return next.startsWith("demo-") || next === "account.html" || next.startsWith("account-") ? next : "account.html";
}

function signUpPayload(form) {
  const firstName = String(form.get("firstName") || "").trim();
  const lastName = String(form.get("lastName") || "").trim();
  return {
    firstName,
    lastName,
    legalName: `${firstName} ${lastName}`.trim(),
    email: form.get("email"),
    countryCode: form.get("countryCode"),
    phone: form.get("phone"),
    country: form.get("country"),
    dateOfBirth: form.get("dateOfBirth"),
    password: form.get("password"),
    acceptedAccuracy: form.get("acceptedAccuracy") === "on",
    acceptedServiceTerms: form.get("acceptedServiceTerms") === "on",
    ...window.AutodyCaptcha.payload(signUpForm)
  };
}

populateCountryCodes();

function setTermsModal(open) {
  if (!termsModal) return;
  termsModal.hidden = !open;
  document.body.classList.toggle("modal-open", open);
}

openTermsButton?.addEventListener("click", () => setTermsModal(true));
document.querySelectorAll("[data-close-terms]").forEach((button) => {
  button.addEventListener("click", () => setTermsModal(false));
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && termsModal && !termsModal.hidden) setTermsModal(false);
});

signUpForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setSignUpMessage("error", "");

  const form = new FormData(signUpForm);
  const password = String(form.get("password") || "");
  const confirmPassword = String(form.get("confirmPassword") || "");

  if (password !== confirmPassword) {
    setSignUpMessage("error", "Passwords do not match.");
    return;
  }

  if (!window.AutodyCaptcha.isComplete(signUpForm)) {
    setSignUpMessage("error", "Complete the human verification.");
    return;
  }

  if (signUpButton) {
    signUpButton.disabled = true;
    signUpButton.textContent = "Creating Account";
  }

  try {
    const response = await fetch("/api/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signUpPayload(form))
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Sign up failed.");
    }

    sessionStorage.setItem("autodyPendingEmail", String(form.get("email") || ""));
    if (data.emailHandoffToken) {
      sessionStorage.setItem("autodyEmailHandoff", data.emailHandoffToken);
    } else {
      sessionStorage.removeItem("autodyEmailHandoff");
    }
    location.href = data.next || signUpNextPage();
  } catch (err) {
    setSignUpMessage("error", err.message || "Sign up failed.");
    window.AutodyCaptcha.refresh(signUpForm);
  } finally {
    if (signUpButton) {
      signUpButton.disabled = false;
      signUpButton.textContent = "Create Account";
    }
  }
});
