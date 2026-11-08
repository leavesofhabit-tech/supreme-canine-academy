// Copy these values into config.js only after the owner confirms the intended Firebase Web app.
// Keep all backend feature flags off until App Check, access policy, content approval, and costs are reviewed.
window.SCA_CONFIG = Object.freeze({
  mode: "local-review", // local-review | emulator | authenticated
  firebase: Object.freeze({
    apiKey: "",
    authDomain: "",
    projectId: "",
    appCheckSiteKey: "",
    authEmulatorUrl: "http://127.0.0.1:9099",
    functionsEmulatorUrl: "http://127.0.0.1:5001"
  }),
  accountMetadataEnabled: false,
  hostedAssistant: Object.freeze({
    enabled: false,
    endpointName: "academyAssistantDev", // academyAssistant requires allowProduction=true
    allowProduction: false
  })
});
