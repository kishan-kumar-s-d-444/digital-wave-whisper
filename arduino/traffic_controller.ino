
// Traffic Light Controller for 4-Way Intersection
// Compatible with Arduino Mega

// Pin definitions for traffic lights
// Road 1 (North)
const int ROAD1_RED = 22;
const int ROAD1_YELLOW = 24;
const int ROAD1_GREEN = 26;

// Road 2 (South)
const int ROAD2_RED = 28;
const int ROAD2_YELLOW = 30;
const int ROAD2_GREEN = 32;

// Road 3 (East)
const int ROAD3_RED = 34;
const int ROAD3_YELLOW = 36;
const int ROAD3_GREEN = 38;

// Road 4 (West)
const int ROAD4_RED = 40;
const int ROAD4_YELLOW = 42;
const int ROAD4_GREEN = 44;

// Traffic control variables
int currentGreenRoad = 1;
int vehicleCounts[4] = {0, 0, 0, 0}; // Vehicle counts for each road
bool emergencyOverride[4] = {false, false, false, false}; // Emergency vehicle flags
bool systemActive = false;

// Timing variables
unsigned long lastSwitchTime = 0;
const unsigned long NORMAL_GREEN_TIME = 5000; // 5 seconds normal green
const unsigned long EMERGENCY_GREEN_TIME = 8000; // 8 seconds for emergency
const unsigned long YELLOW_TIME = 2000; // 2 seconds yellow

// Communication variables
String inputString = "";
bool stringComplete = false;

void setup() {
  Serial.begin(9600);
  
  // Initialize all traffic light pins
  pinMode(ROAD1_RED, OUTPUT);
  pinMode(ROAD1_YELLOW, OUTPUT);
  pinMode(ROAD1_GREEN, OUTPUT);
  
  pinMode(ROAD2_RED, OUTPUT);
  pinMode(ROAD2_YELLOW, OUTPUT);
  pinMode(ROAD2_GREEN, OUTPUT);
  
  pinMode(ROAD3_RED, OUTPUT);
  pinMode(ROAD3_YELLOW, OUTPUT);
  pinMode(ROAD3_GREEN, OUTPUT);
  
  pinMode(ROAD4_RED, OUTPUT);
  pinMode(ROAD4_YELLOW, OUTPUT);
  pinMode(ROAD4_GREEN, OUTPUT);
  
  // Initialize all lights to red
  setAllRed();
  
  Serial.println("Traffic Controller Ready");
  Serial.println("Commands: START, STOP, UPDATE:road:vehicles:emergency");
  Serial.println("Example: UPDATE:1:5:true");
}

void loop() {
  // Check for serial commands
  if (stringComplete) {
    processCommand(inputString);
    inputString = "";
    stringComplete = false;
  }
  
  // Run traffic control logic if system is active
  if (systemActive) {
    manageTrafficLights();
  }
  
  delay(100); // Small delay to prevent overwhelming the system
}

void processCommand(String command) {
  command.trim();
  
  if (command == "START") {
    systemActive = true;
    currentGreenRoad = 1;
    lastSwitchTime = millis();
    Serial.println("Traffic system STARTED");
  }
  else if (command == "STOP") {
    systemActive = false;
    setAllRed();
    Serial.println("Traffic system STOPPED");
  }
  else if (command.startsWith("UPDATE:")) {
    parseUpdateCommand(command);
  }
  else if (command == "STATUS") {
    sendStatus();
  }
}

void parseUpdateCommand(String command) {
  // Format: UPDATE:road:vehicles:emergency
  // Example: UPDATE:1:5:true
  
  int firstColon = command.indexOf(':', 7); // Skip "UPDATE:"
  int secondColon = command.indexOf(':', firstColon + 1);
  
  if (firstColon != -1 && secondColon != -1) {
    int road = command.substring(7, firstColon).toInt();
    int vehicles = command.substring(firstColon + 1, secondColon).toInt();
    bool emergency = command.substring(secondColon + 1) == "true";
    
    if (road >= 1 && road <= 4) {
      vehicleCounts[road - 1] = vehicles;
      emergencyOverride[road - 1] = emergency;
      
      Serial.print("Updated Road ");
      Serial.print(road);
      Serial.print(": ");
      Serial.print(vehicles);
      Serial.print(" vehicles, Emergency: ");
      Serial.println(emergency);
    }
  }
}

void manageTrafficLights() {
  unsigned long currentTime = millis();
  
  // Check for emergency override
  int emergencyRoad = getEmergencyRoad();
  if (emergencyRoad != -1) {
    if (currentGreenRoad != emergencyRoad + 1) {
      switchToRoad(emergencyRoad + 1);
      lastSwitchTime = currentTime;
    }
    return;
  }
  
  // Normal traffic management based on vehicle counts
  unsigned long greenTime = NORMAL_GREEN_TIME;
  
  // Check if it's time to switch
  if (currentTime - lastSwitchTime >= greenTime) {
    int nextRoad = getHighestTrafficRoad();
    if (nextRoad != currentGreenRoad) {
      switchToRoad(nextRoad);
      lastSwitchTime = currentTime;
    } else {
      // If same road has highest traffic, extend green time slightly
      lastSwitchTime = currentTime - (greenTime / 2);
    }
  }
}

int getEmergencyRoad() {
  for (int i = 0; i < 4; i++) {
    if (emergencyOverride[i]) {
      return i;
    }
  }
  return -1;
}

int getHighestTrafficRoad() {
  int maxVehicles = 0;
  int maxRoad = 1;
  
  for (int i = 0; i < 4; i++) {
    if (vehicleCounts[i] > maxVehicles) {
      maxVehicles = vehicleCounts[i];
      maxRoad = i + 1;
    }
  }
  
  return maxRoad;
}

void switchToRoad(int road) {
  // First, set current road to yellow
  setRoadYellow(currentGreenRoad);
  delay(YELLOW_TIME);
  
  // Then set all to red
  setAllRed();
  delay(500);
  
  // Finally, set new road to green
  setRoadGreen(road);
  currentGreenRoad = road;
  
  Serial.print("Switched to Road ");
  Serial.println(road);
}

void setAllRed() {
  digitalWrite(ROAD1_RED, HIGH);
  digitalWrite(ROAD1_YELLOW, LOW);
  digitalWrite(ROAD1_GREEN, LOW);
  
  digitalWrite(ROAD2_RED, HIGH);
  digitalWrite(ROAD2_YELLOW, LOW);
  digitalWrite(ROAD2_GREEN, LOW);
  
  digitalWrite(ROAD3_RED, HIGH);
  digitalWrite(ROAD3_YELLOW, LOW);
  digitalWrite(ROAD3_GREEN, LOW);
  
  digitalWrite(ROAD4_RED, HIGH);
  digitalWrite(ROAD4_YELLOW, LOW);
  digitalWrite(ROAD4_GREEN, LOW);
}

void setRoadGreen(int road) {
  setAllRed(); // Ensure all others are red
  
  switch(road) {
    case 1:
      digitalWrite(ROAD1_RED, LOW);
      digitalWrite(ROAD1_GREEN, HIGH);
      break;
    case 2:
      digitalWrite(ROAD2_RED, LOW);
      digitalWrite(ROAD2_GREEN, HIGH);
      break;
    case 3:
      digitalWrite(ROAD3_RED, LOW);
      digitalWrite(ROAD3_GREEN, HIGH);
      break;
    case 4:
      digitalWrite(ROAD4_RED, LOW);
      digitalWrite(ROAD4_GREEN, HIGH);
      break;
  }
}

void setRoadYellow(int road) {
  switch(road) {
    case 1:
      digitalWrite(ROAD1_GREEN, LOW);
      digitalWrite(ROAD1_YELLOW, HIGH);
      break;
    case 2:
      digitalWrite(ROAD2_GREEN, LOW);
      digitalWrite(ROAD2_YELLOW, HIGH);
      break;
    case 3:
      digitalWrite(ROAD3_GREEN, LOW);
      digitalWrite(ROAD3_YELLOW, HIGH);
      break;
    case 4:
      digitalWrite(ROAD4_GREEN, LOW);
      digitalWrite(ROAD4_YELLOW, HIGH);
      break;
  }
}

void sendStatus() {
  Serial.println("=== TRAFFIC SYSTEM STATUS ===");
  Serial.print("System Active: ");
  Serial.println(systemActive ? "YES" : "NO");
  Serial.print("Current Green Road: ");
  Serial.println(currentGreenRoad);
  
  for (int i = 0; i < 4; i++) {
    Serial.print("Road ");
    Serial.print(i + 1);
    Serial.print(": ");
    Serial.print(vehicleCounts[i]);
    Serial.print(" vehicles");
    if (emergencyOverride[i]) {
      Serial.print(" [EMERGENCY]");
    }
    Serial.println();
  }
  Serial.println("=============================");
}

void serialEvent() {
  while (Serial.available()) {
    char inChar = (char)Serial.read();
    inputString += inChar;
    if (inChar == '\n') {
      stringComplete = true;
    }
  }
}
