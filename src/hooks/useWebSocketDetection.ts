
import { useCallback, useEffect, useRef, useState } from 'react';

interface Detection {
  class: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  originalWidth?: number;
  originalHeight?: number;
}

interface UseWebSocketDetectionProps {
  cameraId: number;
  enabled: boolean;
  onDetectionUpdate: (predictions: Detection[]) => void;
  confidenceThreshold: number;
  overlapThreshold: number;
}

export const useWebSocketDetection = ({
  cameraId,
  enabled,
  onDetectionUpdate,
  confidenceThreshold,
  overlapThreshold
}: UseWebSocketDetectionProps) => {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string>("");
  const [processingTime, setProcessingTime] = useState<number>(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [recentDetections, setRecentDetections] = useState<Detection[]>([]);
  const reconnectAttemptsRef = useRef<number>(0);
  const maxReconnectAttempts = 5;
  const isConnectingRef = useRef<boolean>(false);

  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close(1000, 'Component cleanup');
      }
      wsRef.current = null;
    }
    
    setIsConnected(false);
    setRecentDetections([]);
    isConnectingRef.current = false;
  }, []);

  const connect = useCallback(() => {
    if (isConnectingRef.current) {
      console.log(`[WebSocket] Already connecting for camera ${cameraId}`);
      return;
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log(`[WebSocket] Already connected for camera ${cameraId}`);
      return;
    }

    cleanup();
    isConnectingRef.current = true;

    try {
      const clientId = `camera_${cameraId}_${Date.now()}`;
      const wsUrl = `ws://localhost:8000/ws/${clientId}`;
      
      console.log(`[WebSocket] Connecting camera ${cameraId} to: ${wsUrl}`);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      ws.onopen = () => {
        console.log(`[WebSocket] Connected camera ${cameraId}`);
        setIsConnected(true);
        setConnectionError("");
        reconnectAttemptsRef.current = 0;
        isConnectingRef.current = false;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'detection_result' && data.success && data.predictions) {
            const detections = data.predictions.filter((pred: any) => 
              pred.class && typeof pred.confidence === 'number' && 
              typeof pred.x === 'number' && typeof pred.y === 'number'
            );
            
            setRecentDetections(detections);
            onDetectionUpdate(detections);
            setProcessingTime(data.processing_time || 0);
          }
        } catch (error) {
          console.error(`[WebSocket] Parse error camera ${cameraId}:`, error);
        }
      };

      ws.onclose = (event) => {
        console.log(`[WebSocket] Closed camera ${cameraId}, code: ${event.code}`);
        setIsConnected(false);
        isConnectingRef.current = false;
        
        if (enabled && reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = Math.min(2000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
          console.log(`[WebSocket] Reconnecting camera ${cameraId} in ${delay}ms`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, delay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          setConnectionError("Connection failed. Click reconnect to try again.");
        }
      };

      ws.onerror = (error) => {
        console.error(`[WebSocket] Error camera ${cameraId}:`, error);
        setConnectionError("WebSocket connection failed");
        setIsConnected(false);
        isConnectingRef.current = false;
      };

    } catch (error) {
      console.error(`[WebSocket] Connect error camera ${cameraId}:`, error);
      setConnectionError("Failed to create WebSocket connection");
      isConnectingRef.current = false;
    }
  }, [cameraId, enabled, onDetectionUpdate, cleanup]);

  const sendFrame = useCallback((imageData: string, originalWidth: number, originalHeight: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message = {
        type: 'detection_frame',
        image: imageData,
        confidence_threshold: confidenceThreshold,
        overlap_threshold: overlapThreshold,
        original_width: originalWidth,
        original_height: originalHeight,
        road_id: cameraId
      };
      
      try {
        wsRef.current.send(JSON.stringify(message));
      } catch (error) {
        console.error(`[WebSocket] Send error camera ${cameraId}:`, error);
      }
    }
  }, [cameraId, confidenceThreshold, overlapThreshold]);

  const forceReconnect = useCallback(() => {
    console.log(`[WebSocket] Force reconnect camera ${cameraId}`);
    reconnectAttemptsRef.current = 0;
    cleanup();
    if (enabled) {
      setTimeout(connect, 1000);
    }
  }, [enabled, connect, cleanup, cameraId]);

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      cleanup();
    }

    return cleanup;
  }, [enabled, connect, cleanup]);

  return {
    isConnected,
    connectionError,
    processingTime,
    recentDetections,
    sendFrame,
    forceReconnect
  };
};
