"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { chatWaveApi } from "./api";
import {
  startIncomingRingtone,
  stopIncomingRingtone,
} from "./notification-sounds";

export type CallMedia = "audio" | "video";
export type CallPhase =
  | "idle"
  | "outgoing"
  | "incoming"
  | "connecting"
  | "active"
  | "error";

type Description = { type: "offer" | "answer"; sdp: string };
type Candidate = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment: string | null;
};

type IncomingCall = {
  callId: number;
  conversationId: number;
  fromUserId: number;
  media: CallMedia;
  offer?: Description;
  group: boolean;
};

export type GroupRemoteStreams = Record<number, MediaStream>;
export type GroupMediaStates = Record<
  number,
  { screenSharing: boolean; screenAudio: boolean }
>;

const fallbackIceServers: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

function serializeDescription(description: RTCSessionDescription | null): Description {
  if (!description?.sdp || (description.type !== "offer" && description.type !== "answer")) {
    throw new Error("Браузер не создал описание звонка");
  }
  return { type: description.type, sdp: description.sdp };
}

function serializeCandidate(candidate: RTCIceCandidate): Candidate {
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment,
  };
}

function findVideoSender(peer: RTCPeerConnection) {
  return (
    peer
      .getTransceivers()
      .find((transceiver) => transceiver.receiver.track.kind === "video")
      ?.sender ??
    peer.getSenders().find((sender) => sender.track?.kind === "video")
  );
}

export function useCall(enabled: boolean) {
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [media, setMedia] = useState<CallMedia>("audio");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [callId, setCallId] = useState<number | null>(null);
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [groupCall, setGroupCall] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<GroupRemoteStreams>({});
  const [remoteMediaStates, setRemoteMediaStates] =
    useState<GroupMediaStates>({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenAudioSharing, setScreenAudioSharing] = useState(false);
  const [remoteScreenSharing, setRemoteScreenSharing] = useState(false);
  const [remoteScreenAudioSharing, setRemoteScreenAudioSharing] = useState(false);
  const [screenShareError, setScreenShareError] = useState("");
  const [error, setError] = useState("");

  const socketRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const groupModeRef = useRef(false);
  const groupPeersRef = useRef(new Map<number, RTCPeerConnection>());
  const groupCandidatesRef = useRef(new Map<number, Candidate[]>());
  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const mixedAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenAudioContextRef = useRef<AudioContext | null>(null);
  const callIdRef = useRef<number | null>(null);
  const phaseRef = useRef<CallPhase>("idle");
  const localCandidates = useRef<Candidate[]>([]);
  const remoteCandidates = useRef<Candidate[]>([]);
  const disconnectedTimer = useRef<number | null>(null);
  const iceConfigRef = useRef<{
    servers: RTCIceServer[];
    expiresAt: number;
  } | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (phase === "incoming") return startIncomingRingtone();
    stopIncomingRingtone();
    return undefined;
  }, [phase]);

  useEffect(() => {
    const terminateForNavigation = () => {
      const id = callIdRef.current;
      const currentPhase = phaseRef.current;
      if (!id || currentPhase === "idle" || currentPhase === "error") return;

      const action = groupModeRef.current
        ? "call.group_leave"
        : currentPhase === "incoming"
          ? "call.reject"
          : currentPhase === "outgoing"
            ? "call.cancel"
            : "call.end";
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: action, call_id: id }));
      }
      void chatWaveApi.disconnectCall(id).catch(() => {
        // The WebSocket frame is the primary path; keepalive is a fallback.
      });
      callIdRef.current = null;
    };

    window.addEventListener("beforeunload", terminateForNavigation);
    window.addEventListener("pagehide", terminateForNavigation);
    return () => {
      window.removeEventListener("beforeunload", terminateForNavigation);
      window.removeEventListener("pagehide", terminateForNavigation);
    };
  }, []);

  const send = useCallback((payload: object) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Канал звонков ещё не подключён");
    }
    socket.send(JSON.stringify(payload));
  }, []);

  const destroyPeer = useCallback(() => {
    if (disconnectedTimer.current) {
      window.clearTimeout(disconnectedTimer.current);
      disconnectedTimer.current = null;
    }
    peerRef.current?.close();
    peerRef.current = null;
    groupPeersRef.current.forEach((peer) => peer.close());
    groupPeersRef.current.clear();
    groupCandidatesRef.current.clear();
    if (screenTrackRef.current) {
      screenTrackRef.current.onended = null;
      screenTrackRef.current.stop();
      screenTrackRef.current = null;
    }
    screenAudioTrackRef.current?.stop();
    screenAudioTrackRef.current = null;
    mixedAudioTrackRef.current?.stop();
    mixedAudioTrackRef.current = null;
    if (screenAudioContextRef.current) {
      void screenAudioContextRef.current.close();
      screenAudioContextRef.current = null;
    }
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    cameraTrackRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    remoteStreamRef.current = null;
    setRemoteStreams({});
    setRemoteMediaStates({});
    setGroupCall(false);
    groupModeRef.current = false;
    setScreenSharing(false);
    setScreenAudioSharing(false);
    setRemoteScreenSharing(false);
    setRemoteScreenAudioSharing(false);
    setScreenShareError("");
    localCandidates.current = [];
    remoteCandidates.current = [];
  }, []);

  const reset = useCallback(() => {
    destroyPeer();
    callIdRef.current = null;
    setCallId(null);
    setIncoming(null);
    setConversationId(null);
    setMuted(false);
    setCameraOff(false);
    setPhase("idle");
  }, [destroyPeer]);

  const resolveIceServers = useCallback(async () => {
    const cached = iceConfigRef.current;
    const now = Math.floor(Date.now() / 1000);
    if (cached && cached.expiresAt - 60 > now) return cached.servers;
    try {
      const config = await chatWaveApi.iceServers();
      const servers = config.ice_servers.length
        ? config.ice_servers
        : fallbackIceServers;
      iceConfigRef.current = {
        servers,
        expiresAt: config.expires_at,
      };
      return servers;
    } catch {
      return fallbackIceServers;
    }
  }, []);

  const createPeer = useCallback(
    (stream: MediaStream, servers: RTCIceServer[]) => {
      const peer = new RTCPeerConnection({
        iceServers: servers,
        iceTransportPolicy: "all",
      });
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      if (!stream.getVideoTracks().length) {
        peer.addTransceiver("video", { direction: "sendrecv" });
      }
      peer.ontrack = (event) => {
        if (!remoteStreamRef.current) {
          remoteStreamRef.current = new MediaStream();
        }
        const aggregate = remoteStreamRef.current;
        if (
          !aggregate
            .getTracks()
            .some((track) => track.id === event.track.id)
        ) {
          aggregate.addTrack(event.track);
        }
        const publishStream = () => {
          setRemoteStream(new MediaStream(aggregate.getTracks()));
          if (event.track.kind === "video") setMedia("video");
        };
        if (event.track.kind === "video" && event.track.muted) {
          event.track.onunmute = publishStream;
        } else {
          publishStream();
        }
      };
      peer.onicecandidate = (event) => {
        if (!event.candidate) return;
        const candidate = serializeCandidate(event.candidate);
        if (callIdRef.current) {
          send({ type: "call.candidate", call_id: callIdRef.current, candidate });
        } else {
          localCandidates.current.push(candidate);
        }
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") setPhase("active");
        if (
          peer.connectionState === "failed" ||
          peer.connectionState === "closed"
        ) {
          setError("Не удалось установить соединение");
          setPhase("error");
        }
      };
      peer.oniceconnectionstatechange = () => {
        if (peer.iceConnectionState === "connected" || peer.iceConnectionState === "completed") {
          if (disconnectedTimer.current) {
            window.clearTimeout(disconnectedTimer.current);
            disconnectedTimer.current = null;
          }
          setPhase("active");
        } else if (peer.iceConnectionState === "failed") {
          setError("Медиасоединение прервано. Проверьте сеть.");
          setPhase("error");
        } else if (
          peer.iceConnectionState === "disconnected" &&
          !disconnectedTimer.current
        ) {
          disconnectedTimer.current = window.setTimeout(() => {
            if (peer.iceConnectionState === "disconnected") {
              setError("Медиасоединение прервано. Проверьте сеть.");
              setPhase("error");
            }
            disconnectedTimer.current = null;
          }, 10_000);
        }
      };
      peerRef.current = peer;
      return peer;
    },
    [send],
  );

  const createGroupPeer = useCallback(
    (userId: number, servers: RTCIceServer[]) => {
      const existing = groupPeersRef.current.get(userId);
      if (existing) return existing;
      const peer = new RTCPeerConnection({
        iceServers: servers,
        iceTransportPolicy: "all",
      });
      const source = localStreamRef.current;
      const videoTrack =
        screenTrackRef.current?.readyState === "live"
          ? screenTrackRef.current
          : source?.getVideoTracks()[0];
      const audioTrack =
        mixedAudioTrackRef.current?.readyState === "live"
          ? mixedAudioTrackRef.current
          : source?.getAudioTracks()[0];
      const outbound = new MediaStream(
        [audioTrack, videoTrack].filter(
          (track): track is MediaStreamTrack => Boolean(track),
        ),
      );
      outbound.getTracks().forEach((track) => peer.addTrack(track, outbound));
      if (!videoTrack) {
        peer.addTransceiver("video", { direction: "sendrecv" });
      }
      peer.ontrack = (event) => {
        const publishStream = () => {
          setRemoteStreams((current) => {
            const existingTracks = current[userId]?.getTracks() ?? [];
            const tracks = existingTracks.some(
              (track) => track.id === event.track.id,
            )
              ? existingTracks
              : [...existingTracks, event.track];
            return {
              ...current,
              [userId]: new MediaStream(tracks),
            };
          });
          if (event.track.kind === "video") setMedia("video");
        };
        if (event.track.kind === "video" && event.track.muted) {
          event.track.onunmute = publishStream;
        } else {
          publishStream();
        }
      };
      peer.onicecandidate = (event) => {
        if (!event.candidate || !callIdRef.current) return;
        send({
          type: "call.group_candidate",
          call_id: callIdRef.current,
          target_user_id: userId,
          candidate: serializeCandidate(event.candidate),
        });
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") setPhase("active");
        if (peer.connectionState === "failed") {
          peer.close();
          groupPeersRef.current.delete(userId);
          setRemoteStreams((current) => {
            const next = { ...current };
            delete next[userId];
            return next;
          });
        }
      };
      groupPeersRef.current.set(userId, peer);
      return peer;
    },
    [send],
  );

  const flushGroupCandidates = useCallback(async (userId: number) => {
    const peer = groupPeersRef.current.get(userId);
    if (!peer?.remoteDescription) return;
    const queued = groupCandidatesRef.current.get(userId) ?? [];
    groupCandidatesRef.current.delete(userId);
    for (const candidate of queued) await peer.addIceCandidate(candidate);
  }, []);

  const offerGroupPeer = useCallback(
    async (userId: number) => {
      if (!callIdRef.current) return;
      const peer = createGroupPeer(userId, await resolveIceServers());
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      send({
        type: "call.group_offer",
        call_id: callIdRef.current,
        target_user_id: userId,
        offer: serializeDescription(peer.localDescription),
      });
    },
    [createGroupPeer, resolveIceServers, send],
  );

  const flushCandidates = useCallback(async () => {
    const id = callIdRef.current;
    if (id) {
      localCandidates.current.splice(0).forEach((candidate) => {
        send({ type: "call.candidate", call_id: id, candidate });
      });
    }
    const peer = peerRef.current;
    if (peer?.remoteDescription) {
      for (const candidate of remoteCandidates.current.splice(0)) {
        await peer.addIceCandidate(candidate);
      }
    }
  }, [send]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;

    const connect = () => {
      if (cancelled) return;
      const socket = chatWaveApi.callSocket();
      socketRef.current = socket;
      socket.onopen = () => {
        reconnectAttempt = 0;
        setReady(true);
      };

      socket.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data) as Record<string, unknown>;
          switch (message.type) {
            case "call.incoming": {
              if (phaseRef.current !== "idle") {
                socket.send(
                  JSON.stringify({ type: "call.reject", call_id: message.call_id }),
                );
                return;
              }
              const value: IncomingCall = {
                callId: Number(message.call_id),
                conversationId: Number(message.conversation_id),
                fromUserId: Number(message.from_user_id),
                media: message.media as CallMedia,
                offer: message.offer as Description,
                group: false,
              };
              groupModeRef.current = false;
              setGroupCall(false);
              callIdRef.current = value.callId;
              setCallId(value.callId);
              setConversationId(value.conversationId);
              setMedia(value.media);
              setIncoming(value);
              setPhase("incoming");
              break;
            }
            case "call.group_incoming": {
              if (phaseRef.current !== "idle") return;
              const value: IncomingCall = {
                callId: Number(message.call_id),
                conversationId: Number(message.conversation_id),
                fromUserId: Number(message.from_user_id),
                media: message.media as CallMedia,
                group: true,
              };
              groupModeRef.current = true;
              setGroupCall(true);
              callIdRef.current = value.callId;
              setCallId(value.callId);
              setConversationId(value.conversationId);
              setMedia(value.media);
              setIncoming(value);
              setPhase("incoming");
              break;
            }
            case "call.started":
              callIdRef.current = Number(message.call_id);
              setCallId(Number(message.call_id));
              await flushCandidates();
              break;
            case "call.group_started":
              callIdRef.current = Number(message.call_id);
              setCallId(Number(message.call_id));
              setPhase("active");
              break;
            case "call.group_joined": {
              setIncoming(null);
              setPhase("connecting");
              const participantIds = (message.participant_ids as unknown[]).map(
                Number,
              );
              await Promise.all(participantIds.map(offerGroupPeer));
              if (participantIds.length === 0) setPhase("active");
              break;
            }
            case "call.group_offer": {
              const fromUserId = Number(message.from_user_id);
              const peer = createGroupPeer(
                fromUserId,
                await resolveIceServers(),
              );
              await peer.setRemoteDescription(message.offer as Description);
              await flushGroupCandidates(fromUserId);
              const answer = await peer.createAnswer();
              await peer.setLocalDescription(answer);
              send({
                type: "call.group_answer",
                call_id: callIdRef.current,
                target_user_id: fromUserId,
                answer: serializeDescription(peer.localDescription),
              });
              break;
            }
            case "call.group_answer": {
              const fromUserId = Number(message.from_user_id);
              const peer = groupPeersRef.current.get(fromUserId);
              if (!peer) return;
              await peer.setRemoteDescription(message.answer as Description);
              await flushGroupCandidates(fromUserId);
              break;
            }
            case "call.group_candidate": {
              const fromUserId = Number(message.from_user_id);
              const candidate = message.candidate as Candidate;
              const peer = groupPeersRef.current.get(fromUserId);
              if (peer?.remoteDescription) await peer.addIceCandidate(candidate);
              else {
                const queued = groupCandidatesRef.current.get(fromUserId) ?? [];
                queued.push(candidate);
                groupCandidatesRef.current.set(fromUserId, queued);
              }
              break;
            }
            case "call.group_peer_left": {
              const userId = Number(message.user_id);
              groupPeersRef.current.get(userId)?.close();
              groupPeersRef.current.delete(userId);
              groupCandidatesRef.current.delete(userId);
              setRemoteStreams((current) => {
                const next = { ...current };
                delete next[userId];
                return next;
              });
              setRemoteMediaStates((current) => {
                const next = { ...current };
                delete next[userId];
                return next;
              });
              break;
            }
            case "call.group_media_state": {
              const userId = Number(message.from_user_id);
              setRemoteMediaStates((current) => ({
                ...current,
                [userId]: {
                  screenSharing: Boolean(message.screen_sharing),
                  screenAudio: Boolean(message.screen_audio),
                },
              }));
              break;
            }
            case "call.group_left":
              reset();
              break;
            case "call.accepted": {
              const peer = peerRef.current;
              if (!peer) return;
              await peer.setRemoteDescription(message.answer as Description);
              await flushCandidates();
              setPhase("connecting");
              break;
            }
            case "call.candidate": {
              const candidate = message.candidate as Candidate;
              const peer = peerRef.current;
              if (peer?.remoteDescription) await peer.addIceCandidate(candidate);
              else remoteCandidates.current.push(candidate);
              break;
            }
            case "call.media_state":
              if (Number(message.call_id) === callIdRef.current) {
                setRemoteScreenSharing(Boolean(message.screen_sharing));
                setRemoteScreenAudioSharing(Boolean(message.screen_audio));
              }
              break;
            case "call.reject":
            case "call.cancel":
            case "call.end":
              reset();
              break;
            case "call.error":
              setError(String(message.detail ?? "Ошибка звонка"));
              setPhase("error");
              break;
          }
        } catch {
          setError("Не удалось обработать данные звонка");
          setPhase("error");
        }
      };
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        setReady(false);
        if (cancelled) return;
        if (phaseRef.current !== "idle") {
          setError("Соединение с сервером звонков потеряно");
          setPhase("error");
          return;
        }
        const delay = Math.min(1000 * 2 ** reconnectAttempt, 15_000);
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };
      socket.onerror = () => socket.close();
    };
    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      setReady(false);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [
    createGroupPeer,
    enabled,
    flushCandidates,
    flushGroupCandidates,
    offerGroupPeer,
    reset,
    resolveIceServers,
    send,
  ]);

  const start = useCallback(
    async (
      targetConversationId: number,
      callMedia: CallMedia,
      isGroup = false,
    ) => {
      try {
        setError("");
        setRemoteScreenSharing(false);
        setRemoteScreenAudioSharing(false);
        setScreenShareError("");
        setMedia(callMedia);
        setCameraOff(callMedia === "audio");
        setConversationId(targetConversationId);
        groupModeRef.current = isGroup;
        setGroupCall(isGroup);
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: callMedia === "video",
        });
        localStreamRef.current = stream;
        cameraTrackRef.current = stream.getVideoTracks()[0] ?? null;
        setLocalStream(stream);
        if (isGroup) {
          send({
            type: "call.group_start",
            conversation_id: targetConversationId,
            media: callMedia,
          });
          setPhase("outgoing");
          return;
        }
        const peer = createPeer(stream, await resolveIceServers());
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        send({
          type: "call.start",
          conversation_id: targetConversationId,
          media: callMedia,
          offer: serializeDescription(peer.localDescription),
        });
        setPhase("outgoing");
      } catch (reason) {
        destroyPeer();
        setError(
          reason instanceof Error
            ? reason.message
            : "Нет доступа к камере или микрофону",
        );
        setPhase("error");
      }
    },
    [createPeer, destroyPeer, resolveIceServers, send],
  );

  const accept = useCallback(async () => {
    if (!incoming) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: incoming.media === "video",
      });
      localStreamRef.current = stream;
      cameraTrackRef.current = stream.getVideoTracks()[0] ?? null;
      setLocalStream(stream);
      setCameraOff(incoming.media === "audio");
      if (incoming.group) {
        send({ type: "call.group_join", call_id: incoming.callId });
        setPhase("connecting");
        return;
      }
      const peer = createPeer(stream, await resolveIceServers());
      if (!incoming.offer) throw new Error("Не получено описание звонка");
      await peer.setRemoteDescription(incoming.offer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      send({
        type: "call.accept",
        call_id: incoming.callId,
        answer: serializeDescription(peer.localDescription),
      });
      await flushCandidates();
      setIncoming(null);
      setPhase("connecting");
    } catch (reason) {
      send({
        type: incoming.group ? "call.group_leave" : "call.reject",
        call_id: incoming.callId,
      });
      destroyPeer();
      setError(
        reason instanceof Error ? reason.message : "Не удалось принять звонок",
      );
      setPhase("error");
    }
  }, [
    createPeer,
    destroyPeer,
    flushCandidates,
    incoming,
    resolveIceServers,
    send,
  ]);

  const end = useCallback(() => {
    const id = callIdRef.current;
    if (id) {
      const action = groupModeRef.current
        ? "call.group_leave"
        : phaseRef.current === "incoming"
          ? "call.reject"
          : phaseRef.current === "outgoing"
            ? "call.cancel"
            : "call.end";
      try {
        send({ type: action, call_id: id });
      } catch {
        // Local cleanup must still happen when signaling is already gone.
      }
    }
    reset();
  }, [reset, send]);

  useEffect(() => {
    if (phase !== "outgoing") return;
    const timeout = window.setTimeout(() => {
      end();
      setError("Абонент не ответил");
      setPhase("error");
    }, 60_000);
    return () => window.clearTimeout(timeout);
  }, [end, phase]);

  useEffect(() => {
    if ((phase !== "connecting" && phase !== "active") || !callId) return;
    const heartbeat = () => {
      try {
        send({ type: "call.heartbeat", call_id: callId });
      } catch {
        // WebSocket close handling reports the connection failure.
      }
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 25_000);
    return () => window.clearInterval(interval);
  }, [callId, phase, send]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  }, [localStream, muted]);

  const toggleCamera = useCallback(async () => {
    if (screenTrackRef.current) return;
    const currentTrack = cameraTrackRef.current;
    if (currentTrack?.readyState === "live") {
      const next = !cameraOff;
      currentTrack.enabled = !next;
      setCameraOff(next);
      return;
    }

    setScreenShareError("");
    let cameraStream: MediaStream | null = null;
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, max: 60 },
        },
        audio: false,
      });
      const cameraTrack = cameraStream.getVideoTracks()[0];
      if (!cameraTrack) throw new Error("Камера недоступна");
      const peers = groupModeRef.current
        ? [...groupPeersRef.current.values()]
        : peerRef.current
          ? [peerRef.current]
          : [];
      const videoSenders = peers
        .map(findVideoSender)
        .filter((sender): sender is RTCRtpSender => Boolean(sender));
      if (!videoSenders.length && !groupModeRef.current) {
        throw new Error("Видеоканал звонка недоступен");
      }
      await Promise.all(
        videoSenders.map((sender) => sender.replaceTrack(cameraTrack)),
      );
      cameraTrackRef.current = cameraTrack;
      const audioTracks = localStreamRef.current?.getAudioTracks() ?? [];
      localStreamRef.current?.getVideoTracks().forEach((track) => track.stop());
      localStreamRef.current = new MediaStream([...audioTracks, cameraTrack]);
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
      setCameraOff(false);
      setMedia("video");
    } catch (reason) {
      cameraStream?.getTracks().forEach((track) => track.stop());
      setScreenShareError(
        reason instanceof DOMException && reason.name === "NotAllowedError"
          ? "Доступ к камере не предоставлен"
          : reason instanceof Error
            ? reason.message
            : "Не удалось включить камеру",
      );
    }
  }, [cameraOff]);

  const stopScreenShare = useCallback(async () => {
    const screenTrack = screenTrackRef.current;
    if (!screenTrack) return;
    screenTrack.onended = null;
    screenTrackRef.current = null;

    const peers = groupModeRef.current
      ? [...groupPeersRef.current.values()]
      : peerRef.current
        ? [peerRef.current]
        : [];
    const videoSenders = peers
      .map((peer) =>
        peer
          .getSenders()
          .find(
            (sender) =>
              sender.track === screenTrack || sender.track?.kind === "video",
          ),
      )
      .filter((sender): sender is RTCRtpSender => Boolean(sender));
    const cameraTrack =
      cameraTrackRef.current?.readyState === "live"
        ? cameraTrackRef.current
        : null;
    const mixedAudioTrack = mixedAudioTrackRef.current;
    const microphoneTrack =
      localStreamRef.current
        ?.getAudioTracks()
        .find((track) => track.readyState === "live") ?? null;
    const audioSenders = peers
      .map((peer) =>
        peer
          .getSenders()
          .find(
            (sender) =>
              sender.track === mixedAudioTrack || sender.track?.kind === "audio",
          ),
      )
      .filter((sender): sender is RTCRtpSender => Boolean(sender));
    try {
      await Promise.all(
        videoSenders.map((sender) => sender.replaceTrack(cameraTrack)),
      );
      if (mixedAudioTrack) {
        await Promise.all(
          audioSenders.map((sender) => sender.replaceTrack(microphoneTrack)),
        );
      }
    } catch {
      setScreenShareError("Не удалось восстановить камеру или микрофон");
    } finally {
      screenTrack.stop();
      screenAudioTrackRef.current?.stop();
      screenAudioTrackRef.current = null;
      mixedAudioTrackRef.current?.stop();
      mixedAudioTrackRef.current = null;
      if (screenAudioContextRef.current) {
        void screenAudioContextRef.current.close();
        screenAudioContextRef.current = null;
      }
      const sourceStream = localStreamRef.current;
      setLocalStream(
        sourceStream ? new MediaStream(sourceStream.getTracks()) : null,
      );
      setScreenSharing(false);
      setScreenAudioSharing(false);
    }
    if (callIdRef.current) {
      try {
        send({
          type: groupModeRef.current
            ? "call.group_media_state"
            : "call.media_state",
          call_id: callIdRef.current,
          screen_sharing: false,
          screen_audio: false,
        });
      } catch {
        // A signaling disconnect is handled by the call socket.
      }
    }
  }, [send]);

  const toggleScreenShare = useCallback(async () => {
    if (screenTrackRef.current) {
      await stopScreenShare();
      return;
    }
    if (
      (!groupModeRef.current && !peerRef.current) ||
      (phaseRef.current !== "connecting" && phaseRef.current !== "active")
    ) {
      return;
    }

    setScreenShareError("");
    let displayStream: MediaStream | null = null;
    try {
      const supportedConstraints =
        navigator.mediaDevices.getSupportedConstraints() as Record<
          string,
          boolean | undefined
        >;
      const protectsOwnAudio = Boolean(
        supportedConstraints.restrictOwnAudio,
      );
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 2560 },
          height: { ideal: 1440 },
          frameRate: { ideal: 60, max: 60 },
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 2 },
          sampleRate: { ideal: 48_000 },
          ...(protectsOwnAudio ? { restrictOwnAudio: true } : {}),
        },
        selfBrowserSurface: "exclude",
        systemAudio: "include",
      } as DisplayMediaStreamOptions);
      const screenTrack = displayStream.getVideoTracks()[0];
      const peers = groupModeRef.current
        ? [...groupPeersRef.current.values()]
        : peerRef.current
          ? [peerRef.current]
          : [];
      const videoSenders = peers
        .map(findVideoSender)
        .filter((sender): sender is RTCRtpSender => Boolean(sender));
      if (
        !screenTrack ||
        (videoSenders.length === 0 && !groupModeRef.current)
      ) {
        throw new Error("Видеоканал звонка недоступен");
      }

      screenTrack.contentHint = "detail";
      await Promise.all(
        videoSenders.map((sender) => sender.replaceTrack(screenTrack)),
      );
      for (const videoSender of videoSenders) {
        try {
          const senderParameters = videoSender.getParameters();
          senderParameters.degradationPreference = "maintain-resolution";
          if (senderParameters.encodings.length === 0) {
            senderParameters.encodings = [{}];
          }
          senderParameters.encodings = senderParameters.encodings.map(
            (encoding) => ({
              ...encoding,
              maxBitrate: 12_000_000,
              maxFramerate: 60,
              scaleResolutionDownBy: 1,
            }),
          );
          await videoSender.setParameters(senderParameters);
        } catch {
          // Some browsers manage encoding parameters themselves.
        }
      }

      const displayAudioTrack = displayStream.getAudioTracks()[0] ?? null;
      let sharesAudio = false;
      if (displayAudioTrack) {
        if (!protectsOwnAudio) {
          displayAudioTrack.stop();
          setScreenShareError(
            "Экран транслируется без звука: браузер не поддерживает защиту от эха",
          );
        } else {
          const microphoneTrack =
            localStreamRef.current
              ?.getAudioTracks()
              .find((track) => track.readyState === "live") ?? null;
          const audioSenders = peers
            .map((peer) =>
              peer.getSenders().find((sender) => sender.track?.kind === "audio"),
            )
            .filter((sender): sender is RTCRtpSender => Boolean(sender));
          if (microphoneTrack && audioSenders.length > 0) {
            try {
              const audioContext = new AudioContext();
              const destination = audioContext.createMediaStreamDestination();
              audioContext
                .createMediaStreamSource(new MediaStream([microphoneTrack]))
                .connect(destination);
              audioContext
                .createMediaStreamSource(new MediaStream([displayAudioTrack]))
                .connect(destination);
              await audioContext.resume();

              const mixedTrack = destination.stream.getAudioTracks()[0];
              mixedTrack.contentHint = "music";
              await Promise.all(
                audioSenders.map((sender) => sender.replaceTrack(mixedTrack)),
              );
              for (const audioSender of audioSenders) {
                try {
                  const audioParameters = audioSender.getParameters();
                  if (audioParameters.encodings.length === 0) {
                    audioParameters.encodings = [{}];
                  }
                  audioParameters.encodings = audioParameters.encodings.map(
                    (encoding) => ({ ...encoding, maxBitrate: 256_000 }),
                  );
                  await audioSender.setParameters(audioParameters);
                } catch {
                  // The browser may choose the Opus bitrate automatically.
                }
              }
              screenAudioContextRef.current = audioContext;
              screenAudioTrackRef.current = displayAudioTrack;
              mixedAudioTrackRef.current = mixedTrack;
              sharesAudio = true;
            } catch {
              displayAudioTrack.stop();
              setScreenShareError(
                "Экран транслируется без звука: не удалось подключить аудиоканал",
              );
            }
          } else {
            displayAudioTrack.stop();
          }
        }
      }
      screenTrackRef.current = screenTrack;
      screenTrack.onended = () => {
        void stopScreenShare();
      };
      const audioTracks = localStreamRef.current?.getAudioTracks() ?? [];
      setLocalStream(new MediaStream([...audioTracks, screenTrack]));
      setScreenSharing(true);
      setScreenAudioSharing(sharesAudio);
      setMedia("video");
      if (callIdRef.current) {
        try {
          send({
            type: groupModeRef.current
              ? "call.group_media_state"
              : "call.media_state",
            call_id: callIdRef.current,
            screen_sharing: true,
            screen_audio: sharesAudio,
          });
        } catch {
          // A signaling disconnect is handled by the call socket.
        }
      }
    } catch (reason) {
      displayStream?.getTracks().forEach((track) => track.stop());
      if (reason instanceof DOMException && reason.name === "NotAllowedError") {
        setScreenShareError("Демонстрация экрана отменена");
      } else {
        setScreenShareError(
          reason instanceof Error
            ? reason.message
            : "Не удалось начать демонстрацию экрана",
        );
      }
    }
  }, [send, stopScreenShare]);

  return {
    ready,
    phase,
    media,
    conversationId,
    callId,
    groupCall,
    remoteStream,
    remoteStreams,
    remoteMediaStates,
    localStream,
    muted,
    cameraOff,
    screenSharing,
    screenAudioSharing,
    remoteScreenSharing,
    remoteScreenAudioSharing,
    screenShareError,
    error,
    start,
    accept,
    end,
    reset,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
  };
}
