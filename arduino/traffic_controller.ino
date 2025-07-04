#include <ArduinoJson.h>

// Configuration
#define BASE_GREEN_DELAY 5000
#define MAX_GREEN_DELAY 15000
#define MIN_GREEN_DELAY 3000
#define YELLOW_DELAY 2000
#define VEHICLE_FACTOR 300
#define NUM_ROADS 4

// LED Pins
const int greenLEDs[NUM_ROADS] = {4, 7, 10, 13};
const int yellowLEDs[NUM_ROADS] = {3, 6, 9, 12};
const int redLEDs[NUM_ROADS] = {2, 5, 8, 11};

// Traffic data
int vehicleCounts[NUM_ROADS] = {0};
bool emergencyStatus[NUM_ROADS] = {false};

// System state
bool trafficSystemRunning = false;
int currentRoad = -1;
unsigned long greenEndTime = 0;
bool greenActive = false;

// Function prototypes
void sendJsonMessage(String message, bool includeStatus = false);
void handleSerialCommands();
void parseUpdateCommand(String cmd);
int getHighestPriorityRoad();
void startGreenLight(int road);
void endGreenLight(int road);
void allRedLights();

void setup() {
  Serial.begin(9600);
  Serial.println("[BOOT] Arduino Mega Traffic Controller starting...");
  // Initialize all pins
  for (int i = 0; i < NUM_ROADS; i++) {
    pinMode(greenLEDs[i], OUTPUT);
    pinMode(yellowLEDs[i], OUTPUT);
    pinMode(redLEDs[i], OUTPUT);
    digitalWrite(redLEDs[i], HIGH);  // Start with all red lights ON
  }
  Serial.println("[BOOT] All red lights ON");
  sendJsonMessage("Arduino Initialized", true);
  Serial.println("[BOOT] Initialization complete, waiting for commands...");
}

void loop() {
  handleSerialCommands();

  if (trafficSystemRunning) {
    unsigned long now = millis();

    if (!greenActive) {
      int nextRoad = getHighestPriorityRoad();
      
      if (nextRoad != -1) {
        currentRoad = nextRoad;
        startGreenLight(currentRoad);
        greenActive = true;
      }
    }

    if (greenActive && millis() >= greenEndTime) {
      endGreenLight(currentRoad);
      greenActive = false;
      currentRoad = -1;
    }
  }
}

void sendJsonMessage(String message, bool includeStatus) {
  StaticJsonDocument<200> doc;
  doc["message"] = message;
  if (includeStatus) {
    doc["running"] = trafficSystemRunning;
    doc["currentRoad"] = currentRoad + 1;
  }
  
  serializeJson(doc, Serial);
  Serial.println();
}

void handleSerialCommands() {
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    Serial.print("[SERIAL] Received command: ");
    Serial.println(command);

    if (command == "STATUS") {
      sendJsonMessage("System operational", true);
      Serial.println("[INFO] STATUS command processed");
    }
    else if (command == "START") {
      trafficSystemRunning = true;
      sendJsonMessage("Traffic system started");
      Serial.println("[INFO] Traffic system started");
    }
    else if (command == "STOP") {
      trafficSystemRunning = false;
      allRedLights();
      greenActive = false;
      currentRoad = -1;
      sendJsonMessage("Traffic system stopped");
      Serial.println("[INFO] Traffic system stopped");
    }
    else if (command.startsWith("UPDATE:")) {
      Serial.println("[INFO] Processing UPDATE command");
      parseUpdateCommand(command);
    }
    else {
      sendJsonMessage("Unknown command");
      Serial.println("[WARN] Unknown command received");
    }
  }
}

void parseUpdateCommand(String cmd) {
  Serial.print("[UPDATE] Raw command: ");
  Serial.println(cmd);
  cmd.replace("UPDATE:", "");
  int firstColon = cmd.indexOf(':');
  int secondColon = cmd.indexOf(':', firstColon + 1);

  if (firstColon == -1 || secondColon == -1) {
    sendJsonMessage("Invalid UPDATE format");
    Serial.println("[ERROR] Invalid UPDATE format");
    return;
  }

  int road = cmd.substring(0, firstColon).toInt() - 1;
  int count = cmd.substring(firstColon + 1, secondColon).toInt();
  String emergencyStr = cmd.substring(secondColon + 1);

  Serial.print("[UPDATE] Parsed road: ");
  Serial.print(road + 1);
  Serial.print(", count: ");
  Serial.print(count);
  Serial.print(", emergency: ");
  Serial.println(emergencyStr);

  if (road >= 0 && road < NUM_ROADS) {
    vehicleCounts[road] = count;
    emergencyStatus[road] = (emergencyStr == "true");

    String msg = "Updated Road " + String(road + 1) + 
                 ": Vehicles=" + String(count) + 
                 ", Emergency=" + (emergencyStatus[road] ? "true" : "false");
    sendJsonMessage(msg);
    Serial.println("[UPDATE] Road data updated");
  } else {
    sendJsonMessage("Invalid road ID");
    Serial.println("[ERROR] Invalid road ID");
  }
}

int getHighestPriorityRoad() {
  // 1. Emergency vehicle gets highest priority
  for (int i = 0; i < NUM_ROADS; i++) {
    if (emergencyStatus[i]) {
      Serial.print("[PRIORITY] Emergency vehicle detected on Road ");
      Serial.println(i + 1);
      return i;
    }
  }

  // 2. Choose road with highest vehicle count
  int maxCount = 0;
  int selectedRoad = -1;
  for (int i = 0; i < NUM_ROADS; i++) {
    if (vehicleCounts[i] > maxCount) {
      maxCount = vehicleCounts[i];
      selectedRoad = i;
    }
  }

  if (selectedRoad != -1) {
    Serial.print("[PRIORITY] Road selected by vehicle count: ");
    Serial.println(selectedRoad + 1);
  }

  return selectedRoad;
}

void startGreenLight(int road) {
  int dynamicDelay = BASE_GREEN_DELAY + (vehicleCounts[road] * VEHICLE_FACTOR);
  dynamicDelay = constrain(dynamicDelay, MIN_GREEN_DELAY, MAX_GREEN_DELAY);
  greenEndTime = millis() + dynamicDelay;

  String msg = "Green light for Road " + String(road + 1) + 
               " for " + String(dynamicDelay) + "ms";
  sendJsonMessage(msg);
  Serial.print("[LIGHT] Green ON for Road ");
  Serial.print(road + 1);
  Serial.print(", duration: ");
  Serial.print(dynamicDelay);
  Serial.println("ms");

  allRedLights();                        // Turn off all lights
  digitalWrite(redLEDs[road], LOW);     // Turn off red before green
  digitalWrite(yellowLEDs[road], HIGH); // Yellow warning
  delay(YELLOW_DELAY);
  digitalWrite(yellowLEDs[road], LOW);
  digitalWrite(greenLEDs[road], HIGH);  // Green ON
}

void endGreenLight(int road) {
  digitalWrite(greenLEDs[road], LOW);     // Turn off green
  digitalWrite(yellowLEDs[road], HIGH);   // Yellow before red
  delay(YELLOW_DELAY);
  digitalWrite(yellowLEDs[road], LOW);
  digitalWrite(redLEDs[road], HIGH);      // Red ON
  Serial.print("[LIGHT] Green OFF for Road ");
  Serial.println(road + 1);

  vehicleCounts[road] = 0;                // Reset road data
  emergencyStatus[road] = false;
}

void allRedLights() {
  for (int i = 0; i < NUM_ROADS; i++) {
    digitalWrite(greenLEDs[i], LOW);
    digitalWrite(yellowLEDs[i], LOW);
    digitalWrite(redLEDs[i], HIGH);
  }
}

