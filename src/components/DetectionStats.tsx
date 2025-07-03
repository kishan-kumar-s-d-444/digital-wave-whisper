
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Car, Truck, Users } from "lucide-react";

interface Detection {
  class: string;
  confidence: number;
}

interface DetectionStatsProps {
  currentDetections: Detection[];
  totalDetections: number;
}

export const DetectionStats = ({ currentDetections, totalDetections }: DetectionStatsProps) => {
  // Count vehicles by class
  const vehicleCounts = currentDetections.reduce((acc, detection) => {
    acc[detection.class] = (acc[detection.class] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const getVehicleIcon = (className: string) => {
    if (className.toLowerCase().includes('car')) return Car;
    if (className.toLowerCase().includes('truck')) return Truck;
    return Car; // Default icon
  };

  return (
    <Card className="bg-black/40 backdrop-blur-md border-white/20">
      <CardHeader>
        <CardTitle className="text-white flex items-center">
          <BarChart3 className="h-5 w-5 mr-2" />
          Detection Analytics
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Detections */}
        <div>
          <h4 className="text-purple-200 text-sm font-medium mb-2">Current Frame</h4>
          <div className="bg-black/30 rounded-lg p-3">
            <div className="text-2xl font-bold text-white mb-1">
              {currentDetections.length}
            </div>
            <div className="text-purple-200 text-sm">Vehicles Detected</div>
          </div>
        </div>

        {/* Vehicle Types */}
        {Object.keys(vehicleCounts).length > 0 && (
          <div>
            <h4 className="text-purple-200 text-sm font-medium mb-2">Vehicle Types</h4>
            <div className="space-y-2">
              {Object.entries(vehicleCounts).map(([className, count]) => {
                const IconComponent = getVehicleIcon(className);
                return (
                  <div key={className} className="flex items-center justify-between bg-black/30 rounded-lg p-2">
                    <div className="flex items-center space-x-2">
                      <IconComponent className="h-4 w-4 text-purple-400" />
                      <span className="text-white capitalize">{className}</span>
                    </div>
                    <Badge variant="secondary" className="bg-purple-600 text-white">
                      {count}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Total Statistics */}
        <div>
          <h4 className="text-purple-200 text-sm font-medium mb-2">Session Stats</h4>
          <div className="bg-black/30 rounded-lg p-3">
            <div className="text-xl font-bold text-white mb-1">
              {totalDetections}
            </div>
            <div className="text-purple-200 text-sm">Total Detections</div>
          </div>
        </div>

        {/* Confidence Levels */}
        {currentDetections.length > 0 && (
          <div>
            <h4 className="text-purple-200 text-sm font-medium mb-2">Confidence Levels</h4>
            <div className="space-y-1">
              {currentDetections.map((detection, index) => (
                <div key={index} className="flex items-center justify-between text-sm">
                  <span className="text-purple-200 capitalize">{detection.class}</span>
                  <span className="text-white">{Math.round(detection.confidence * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
