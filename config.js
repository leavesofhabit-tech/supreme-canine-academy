// Public Firebase Web configuration belongs here only after the owner configures it.
// Firebase web API keys are public identifiers, not service-account secrets.
// Never place Admin SDK credentials, private keys, or user passwords in this file.
window.SCA_CONFIG = Object.freeze({
  mode: "local-review",
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
    endpointName: "academyAssistantDev",
    allowProduction: false
  })
});
