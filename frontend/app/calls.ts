"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiActiveGroupCall, chatWaveApi } from "./api";
import {
  startIncomingRingtone,
  stopIncomingRingtone,
} from "./notification-sounds";
import {
  cameraConstraintsFor,
  getMediaDevicePreferences,
  MEDIA_PREFERENCES_EVENT,
  microphoneConstraintsFor,
  type MediaDevicePreferences,
} from "./media-preferences";

export type CallMedia = "audio" | "video";
export type ScreenShareQuality =
  | "720p30"
  | "1080p30"
  | "1080p60"
  | "1440p60";
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
export type GroupScreenStreams = Record<number, MediaStream>;
export type GroupScreenAudioStreams = Record<number, MediaStream>;
export type DesktopScreenSource = ChatWaveDesktopScreenSource;
export type GroupMediaStates = Record<
  number,
  {
    screenSharing: boolean;
    screenAudio: boolean;
    microphoneMuted: boolean;
    cameraEnabled: boolean;
  }
>;

const SCREEN_QUALITY_STORAGE_KEY = "chatwave-screen-share-quality";
export const SCREEN_SHARE_PRESETS: Record<
  ScreenShareQuality,
  { label: string; width: number; height: number; fps: number; bitrate: number }
> = {
  "720p30": {
    label: "720p · 30 FPS",
    width: 1280,
    height: 720,
    fps: 30,
    bitrate: 3_500_000,
  },
  "1080p30": {
    label: "1080p · 30 FPS",
    width: 1920,
    height: 1080,
    fps: 30,
    bitrate: 6_000_000,
  },
  "1080p60": {
    label: "1080p · 60 FPS",
    width: 1920,
    height: 1080,
    fps: 60,
    bitrate: 9_000_000,
  },
  "1440p60": {
    label: "1440p · 60 FPS",
    width: 2560,
    height: 1440,
    fps: 60,
    bitrate: 12_000_000,
  },
};

function storedScreenShareQuality(): ScreenShareQuality {
  if (typeof window === "undefined") return "1080p30";
  const value = window.localStorage.getItem(SCREEN_QUALITY_STORAGE_KEY);
  return value && value in SCREEN_SHARE_PRESETS
    ? (value as ScreenShareQuality)
    : "1080p30";
}

function isMobileCallDevice() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

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

function findVideoSender(
  peer: RTCPeerConnection,
  excluded?: RTCRtpSender,
) {
  return (
    peer
      .getTransceivers()
      .find(
        (transceiver) =>
          transceiver.receiver.track.kind === "video" &&
          transceiver.sender !== excluded,
      )
      ?.sender ??
    peer
      .getSenders()
      .find(
        (sender) =>
          sender !== excluded && sender.track?.kind === "video",
      )
  );
}

function addPrimaryCallTransceivers(
  peer: RTCPeerConnection,
  stream: MediaStream,
) {
  const audioTrack = stream.getAudioTracks()[0];
  const videoTrack = stream.getVideoTracks()[0];

  // addTrack-created transceivers can be associated with matching m-lines
  // when this peer is the answerer. Pre-creating them with addTransceiver
  // before setRemoteDescription() made Huawei/Chromium answer `recvonly`,
  // leaving the caller with a `sendonly` audio channel and no remote track.
  if (audioTrack) peer.addTrack(audioTrack, stream);
  else peer.addTransceiver("audio", { direction: "sendrecv" });
  if (videoTrack) peer.addTrack(videoTrack, stream);
  else peer.addTransceiver("video", { direction: "sendrecv" });
}

function mediaAccessError(reason: unknown, video: boolean) {
  if (reason instanceof DOMException) {
    if (
      reason.name === "NotAllowedError" ||
      reason.name === "SecurityError"
    ) {
      return video
        ? "Нет доступа к микрофону или камере. Разрешите их для ChatWave в настройках сайта и Windows, затем нажмите «Повторить»."
        : "Нет доступа к микрофону. Разрешите его для ChatWave в настройках сайта и Windows, затем нажмите «Повторить».";
    }
    if (
      reason.name === "NotFoundError" ||
      reason.name === "DevicesNotFoundError"
    ) {
      return video
        ? "Микрофон или камера не найдены. Подключите устройство и повторите."
        : "Микрофон не найден. Подключите устройство и повторите.";
    }
    if (reason.name === "NotReadableError") {
      return "Устройство занято другим приложением. Закройте его там и повторите.";
    }
  }
  return reason instanceof Error
    ? reason.message
    : "Не удалось получить доступ к микрофону или камере";
}

async function acquireCallMedia(callMedia: CallMedia) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: microphoneConstraintsFor(),
      video: callMedia === "video" ? cameraConstraintsFor() : false,
    });
  } catch (reason) {
    if (
      reason instanceof DOMException &&
      ["OverconstrainedError", "NotFoundError"].includes(reason.name)
    ) {
      return navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video:
          callMedia === "video"
            ? {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 },
              }
            : false,
      });
    }
    throw reason;
  }
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
  const [availableGroupCalls, setAvailableGroupCalls] = useState<
    ApiActiveGroupCall[]
  >([]);
  const [remoteStreams, setRemoteStreams] = useState<GroupRemoteStreams>({});
  const [remoteScreenStream, setRemoteScreenStream] =
    useState<MediaStream | null>(null);
  const [groupScreenStreams, setGroupScreenStreams] =
    useState<GroupScreenStreams>({});
  const [remoteScreenAudioStream, setRemoteScreenAudioStream] =
    useState<MediaStream | null>(null);
  const [groupScreenAudioStreams, setGroupScreenAudioStreams] =
    useState<GroupScreenAudioStreams>({});
  const [remoteMediaStates, setRemoteMediaStates] =
    useState<GroupMediaStates>({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] =
    useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenAudioSharing, setScreenAudioSharing] = useState(false);
  const [screenShareQuality, setScreenShareQualityState] =
    useState<ScreenShareQuality>(storedScreenShareQuality);
  const [remoteScreenSharing, setRemoteScreenSharing] = useState(false);
  const [remoteScreenAudioSharing, setRemoteScreenAudioSharing] = useState(false);
  const [remoteMuted, setRemoteMuted] = useState(false);
  const [remoteCameraEnabled, setRemoteCameraEnabled] = useState(false);
  const [screenShareError, setScreenShareError] = useState("");
  const [desktopScreenSources, setDesktopScreenSources] = useState<
    DesktopScreenSource[]
  >([]);
  const [error, setError] = useState("");
  const [audioOutputDeviceId, setAudioOutputDeviceId] = useState(
    () => getMediaDevicePreferences().audioOutputId,
  );

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
  const screenAudioSendersRef = useRef(
    new Map<RTCPeerConnection, RTCRtpSender>(),
  );
  const screenVideoSendersRef = useRef(
    new Map<RTCPeerConnection, RTCRtpSender>(),
  );
  const screenVideoFallbackPeersRef = useRef(
    new Set<RTCPeerConnection>(),
  );

  useEffect(() => {
    if (!enabled) {
      const resetTimer = window.setTimeout(
        () => setAvailableGroupCalls([]),
        0,
      );
      return () => window.clearTimeout(resetTimer);
    }
    let active = true;
    const refresh = () => {
      void chatWaveApi
        .activeGroupCalls()
        .then((calls) => active && setAvailableGroupCalls(calls))
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [enabled]);
  const desktopCaptureApprovedRef = useRef(false);
  const desktopCaptureSelectionRef = useRef<{
    sourceId: string;
    withAudio: boolean;
  } | null>(null);
  const recoveringMicrophoneRef = useRef(false);
  const lastStartAttemptRef = useRef<{
    conversationId: number;
    media: CallMedia;
    group: boolean;
  } | null>(null);
  const callIdRef = useRef<number | null>(null);
  const phaseRef = useRef<CallPhase>("idle");
  const mutedRef = useRef(false);
  const screenSharingRef = useRef(false);
  const screenAudioSharingRef = useRef(false);
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
    const update = (event: Event) => {
      setAudioOutputDeviceId(
        (event as CustomEvent<MediaDevicePreferences>).detail.audioOutputId,
      );
    };
    window.addEventListener(MEDIA_PREFERENCES_EVENT, update);
    return () => window.removeEventListener(MEDIA_PREFERENCES_EVENT, update);
  }, []);

  useEffect(() => {
    screenSharingRef.current = screenSharing;
    screenAudioSharingRef.current = screenAudioSharing;
  }, [screenAudioSharing, screenSharing]);

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
    screenAudioSendersRef.current.clear();
    screenVideoSendersRef.current.clear();
    screenVideoFallbackPeersRef.current.clear();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    cameraTrackRef.current = null;
    setLocalStream(null);
    setLocalScreenStream(null);
    setRemoteStream(null);
    setRemoteScreenStream(null);
    setRemoteScreenAudioStream(null);
    remoteStreamRef.current = null;
    setRemoteStreams({});
    setGroupScreenStreams({});
    setGroupScreenAudioStreams({});
    setRemoteMediaStates({});
    setGroupCall(false);
    groupModeRef.current = false;
    mutedRef.current = false;
    screenSharingRef.current = false;
    screenAudioSharingRef.current = false;
    setScreenSharing(false);
    setScreenAudioSharing(false);
    setRemoteScreenSharing(false);
    setRemoteScreenAudioSharing(false);
    setRemoteMuted(false);
    setRemoteCameraEnabled(false);
    setScreenShareError("");
    setDesktopScreenSources([]);
    desktopCaptureApprovedRef.current = false;
    desktopCaptureSelectionRef.current = null;
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
      // Keep the m-line order stable across browsers. getTracks() may return
      // video/audio in a different order and bind the screen transceiver to
      // the wrong remote channel.
      addPrimaryCallTransceivers(peer, stream);
      const screenVideoTransceiver = peer.addTransceiver("video", {
        direction: "sendrecv",
      });
      screenVideoSendersRef.current.set(
        peer,
        screenVideoTransceiver.sender,
      );
      const screenAudioTransceiver = peer.addTransceiver("audio", {
        direction: "sendrecv",
      });
      screenAudioSendersRef.current.set(
        peer,
        screenAudioTransceiver.sender,
      );
      peer.ontrack = (event) => {
        if (event.transceiver === screenVideoTransceiver) {
          const publishScreenVideo = () =>
            setRemoteScreenStream(new MediaStream([event.track]));
          event.track.onunmute = publishScreenVideo;
          event.track.onmute = publishScreenVideo;
          event.track.onended = publishScreenVideo;
          if (!event.track.muted) publishScreenVideo();
          return;
        }
        if (event.transceiver === screenAudioTransceiver) {
          const publishScreenAudio = () =>
            setRemoteScreenAudioStream(new MediaStream([event.track]));
          event.track.onunmute = publishScreenAudio;
          event.track.onmute = publishScreenAudio;
          event.track.onended = publishScreenAudio;
          publishScreenAudio();
          return;
        }
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
        };
        if (event.track.kind === "video") {
          // replaceTrack() keeps the same remote track object. Publishing on
          // every mute transition makes React observe when screen RTP really
          // starts or stops instead of relying only on the signaling flag.
          event.track.onunmute = publishStream;
          event.track.onmute = publishStream;
          event.track.onended = publishStream;
        }
        if (event.track.kind !== "video" || !event.track.muted) {
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
      const activeScreenTrack =
        screenTrackRef.current?.readyState === "live"
          ? screenTrackRef.current
          : undefined;
      const videoTrack =
        activeScreenTrack ??
        (cameraTrackRef.current?.readyState === "live"
          ? cameraTrackRef.current
          : source?.getVideoTracks()[0]);
      const audioTrack = source?.getAudioTracks()[0];
      const outbound = new MediaStream(
        [audioTrack, videoTrack].filter(
          (track): track is MediaStreamTrack => Boolean(track),
        ),
      );
      addPrimaryCallTransceivers(peer, outbound);
      if (activeScreenTrack) {
        screenVideoFallbackPeersRef.current.add(peer);
      }
      const screenVideoTransceiver = peer.addTransceiver(
        activeScreenTrack ?? "video",
        { direction: "sendrecv" },
      );
      screenVideoSendersRef.current.set(
        peer,
        screenVideoTransceiver.sender,
      );
      const activeScreenAudioTrack =
        screenAudioTrackRef.current?.readyState === "live"
          ? screenAudioTrackRef.current
          : undefined;
      const screenAudioTransceiver = peer.addTransceiver(
        activeScreenAudioTrack ?? "audio",
        { direction: "sendrecv" },
      );
      screenAudioSendersRef.current.set(
        peer,
        screenAudioTransceiver.sender,
      );
      peer.ontrack = (event) => {
        if (event.transceiver === screenVideoTransceiver) {
          const publishScreenVideo = () =>
            setGroupScreenStreams((current) => ({
              ...current,
              [userId]: new MediaStream([event.track]),
            }));
          event.track.onunmute = publishScreenVideo;
          event.track.onmute = publishScreenVideo;
          event.track.onended = publishScreenVideo;
          if (!event.track.muted) publishScreenVideo();
          return;
        }
        if (event.transceiver === screenAudioTransceiver) {
          const publishScreenAudio = () =>
            setGroupScreenAudioStreams((current) => ({
              ...current,
              [userId]: new MediaStream([event.track]),
            }));
          event.track.onunmute = publishScreenAudio;
          event.track.onmute = publishScreenAudio;
          event.track.onended = publishScreenAudio;
          publishScreenAudio();
          return;
        }
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
        };
        if (event.track.kind === "video") {
          event.track.onunmute = publishStream;
          event.track.onmute = publishStream;
          event.track.onended = publishStream;
        }
        if (event.track.kind !== "video" || !event.track.muted) {
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
          screenAudioSendersRef.current.delete(peer);
          screenVideoSendersRef.current.delete(peer);
          screenVideoFallbackPeersRef.current.delete(peer);
          setRemoteStreams((current) => {
            const next = { ...current };
            delete next[userId];
            return next;
          });
          setGroupScreenAudioStreams((current) => {
            const next = { ...current };
            delete next[userId];
            return next;
          });
          setGroupScreenStreams((current) => {
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
              setRemoteCameraEnabled(value.media === "video");
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
              setRemoteCameraEnabled(value.media === "video");
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
              send({
                type: "call.group_media_state",
                call_id: callIdRef.current,
                screen_sharing: screenSharingRef.current,
                screen_audio: screenAudioSharingRef.current,
                microphone_muted: mutedRef.current,
                camera_enabled:
                  Boolean(cameraTrackRef.current?.enabled) &&
                  !screenSharingRef.current,
              });
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
              const leavingPeer = groupPeersRef.current.get(userId);
              if (leavingPeer) {
                screenAudioSendersRef.current.delete(leavingPeer);
                screenVideoSendersRef.current.delete(leavingPeer);
                screenVideoFallbackPeersRef.current.delete(leavingPeer);
              }
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
              setGroupScreenAudioStreams((current) => {
                const next = { ...current };
                delete next[userId];
                return next;
              });
              setGroupScreenStreams((current) => {
                const next = { ...current };
                delete next[userId];
                return next;
              });
              break;
            }
            case "call.group_peer_joined": {
              send({
                type: "call.group_media_state",
                call_id: callIdRef.current,
                screen_sharing: screenSharingRef.current,
                screen_audio: screenAudioSharingRef.current,
                microphone_muted: mutedRef.current,
                camera_enabled:
                  Boolean(cameraTrackRef.current?.enabled) &&
                  !screenSharingRef.current,
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
                  microphoneMuted: Boolean(message.microphone_muted),
                  cameraEnabled: Boolean(message.camera_enabled),
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
              send({
                type: "call.media_state",
                call_id: callIdRef.current,
                screen_sharing: screenSharingRef.current,
                screen_audio: screenAudioSharingRef.current,
                microphone_muted: mutedRef.current,
                camera_enabled:
                  Boolean(cameraTrackRef.current?.enabled) &&
                  !screenSharingRef.current,
              });
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
                setRemoteMuted(Boolean(message.microphone_muted));
                setRemoteCameraEnabled(Boolean(message.camera_enabled));
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
      lastStartAttemptRef.current = {
        conversationId: targetConversationId,
        media: callMedia,
        group: isGroup,
      };
      try {
        setError("");
        setRemoteScreenSharing(false);
        setRemoteScreenAudioSharing(false);
        setScreenShareError("");
        setMedia(callMedia);
        setRemoteCameraEnabled(callMedia === "video");
        setCameraOff(callMedia === "audio");
        setConversationId(targetConversationId);
        groupModeRef.current = isGroup;
        setGroupCall(isGroup);
        const stream = await acquireCallMedia(callMedia);
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
        setError(mediaAccessError(reason, callMedia === "video"));
        setPhase("error");
      }
    },
    [createPeer, destroyPeer, resolveIceServers, send],
  );

  const accept = useCallback(async () => {
    if (!incoming) return;
    try {
      const stream = await acquireCallMedia(incoming.media);
      localStreamRef.current = stream;
      cameraTrackRef.current = stream.getVideoTracks()[0] ?? null;
      setLocalStream(stream);
      setCameraOff(incoming.media === "audio");
      if (incoming.group) {
        send({ type: "call.group_join", call_id: incoming.callId });
        send({
          type: "call.group_media_state",
          call_id: incoming.callId,
          screen_sharing: false,
          screen_audio: false,
          microphone_muted: mutedRef.current,
          camera_enabled: incoming.media === "video",
        });
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
      send({
        type: "call.media_state",
        call_id: incoming.callId,
        screen_sharing: false,
        screen_audio: false,
        microphone_muted: mutedRef.current,
        camera_enabled: incoming.media === "video",
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
      setError(mediaAccessError(reason, incoming.media === "video"));
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

  const joinAvailableGroupCall = useCallback(
    async (available: ApiActiveGroupCall) => {
      if (phaseRef.current !== "idle") return;
      try {
        setError("");
        setConversationId(available.conversation_id);
        setMedia(available.media);
        groupModeRef.current = true;
        setGroupCall(true);
        callIdRef.current = available.call_id;
        setCallId(available.call_id);
        const stream = await acquireCallMedia(available.media);
        localStreamRef.current = stream;
        cameraTrackRef.current = stream.getVideoTracks()[0] ?? null;
        setLocalStream(stream);
        setCameraOff(available.media === "audio");
        send({ type: "call.group_join", call_id: available.call_id });
        send({
          type: "call.group_media_state",
          call_id: available.call_id,
          screen_sharing: false,
          screen_audio: false,
          microphone_muted: mutedRef.current,
          camera_enabled: available.media === "video",
        });
        setAvailableGroupCalls((current) =>
          current.filter((call) => call.call_id !== available.call_id),
        );
        setPhase("connecting");
      } catch (reason) {
        destroyPeer();
        setError(mediaAccessError(reason, available.media === "video"));
        setPhase("error");
      }
    },
    [destroyPeer, send],
  );

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

  const retry = useCallback(() => {
    const attempt = lastStartAttemptRef.current;
    if (!attempt) return;
    void start(attempt.conversationId, attempt.media, attempt.group);
  }, [start]);

  const recoverDesktopMicrophone = useCallback(async () => {
    if (
      !window.chatWaveDesktop ||
      recoveringMicrophoneRef.current ||
      (phaseRef.current !== "connecting" && phaseRef.current !== "active")
    ) {
      return;
    }
    recoveringMicrophoneRef.current = true;
    let replacementStream: MediaStream | null = null;
    try {
      replacementStream = await navigator.mediaDevices.getUserMedia({
        audio: microphoneConstraintsFor(),
        video: false,
      });
      const replacement = replacementStream.getAudioTracks()[0];
      if (!replacement) throw new Error("Микрофон недоступен");
      replacement.enabled = !mutedRef.current;
      const peers = groupModeRef.current
        ? [...groupPeersRef.current.values()]
        : peerRef.current
          ? [peerRef.current]
          : [];
      const microphoneSenders = peers
        .map((peer) =>
          peer
            .getSenders()
            .find(
              (sender) =>
                sender !== screenAudioSendersRef.current.get(peer) &&
                sender.track?.kind === "audio",
            ),
        )
        .filter((sender): sender is RTCRtpSender => Boolean(sender));
      await Promise.all(
        microphoneSenders.map((sender) => sender.replaceTrack(replacement)),
      );
      const current = localStreamRef.current;
      current?.getAudioTracks().forEach((track) => track.stop());
      const videoTracks = current?.getVideoTracks() ?? [];
      localStreamRef.current = new MediaStream([
        replacement,
        ...videoTracks,
      ]);
      const previewVideo =
        screenTrackRef.current?.readyState === "live"
          ? [screenTrackRef.current]
          : videoTracks;
      setLocalStream(new MediaStream([replacement, ...previewVideo]));
      setScreenShareError("");
    } catch {
      replacementStream?.getTracks().forEach((track) => track.stop());
      setScreenShareError("Не удалось восстановить микрофон");
    } finally {
      recoveringMicrophoneRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (
      !window.chatWaveDesktop ||
      (phase !== "connecting" && phase !== "active")
    ) {
      return;
    }
    let mutedSince = 0;
    const interval = window.setInterval(() => {
      const microphone = localStreamRef.current?.getAudioTracks()[0];
      if (!microphone || microphone.readyState === "ended") {
        void recoverDesktopMicrophone();
        return;
      }
      if (microphone.muted) {
        if (!mutedSince) mutedSince = Date.now();
        if (Date.now() - mutedSince > 2_500) {
          mutedSince = 0;
          void recoverDesktopMicrophone();
        }
      } else {
        mutedSince = 0;
      }
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [phase, recoverDesktopMicrophone]);

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
    mutedRef.current = next;
    setMuted(next);
    const id = callIdRef.current;
    if (
      id &&
      (phaseRef.current === "connecting" || phaseRef.current === "active")
    ) {
      try {
        send({
          type: groupModeRef.current
            ? "call.group_media_state"
            : "call.media_state",
          call_id: id,
          screen_sharing: screenSharingRef.current,
          screen_audio: screenAudioSharingRef.current,
          microphone_muted: next,
          camera_enabled:
            Boolean(cameraTrackRef.current?.enabled) &&
            !screenSharingRef.current,
        });
      } catch {
        // Signaling disconnect handling reports the connection failure.
      }
    }
  }, [localStream, muted, send]);

  const toggleCamera = useCallback(async () => {
    const currentTrack = cameraTrackRef.current;
    if (currentTrack?.readyState === "live") {
      const next = !cameraOff;
      currentTrack.enabled = !next;
      setCameraOff(next);
      const id = callIdRef.current;
      if (id) {
        try {
          send({
            type: groupModeRef.current
              ? "call.group_media_state"
              : "call.media_state",
            call_id: id,
            screen_sharing: screenSharingRef.current,
            screen_audio: screenAudioSharingRef.current,
            microphone_muted: mutedRef.current,
            camera_enabled: !next,
          });
        } catch {
          // Signaling disconnect handling reports the connection failure.
        }
      }
      return;
    }

    setScreenShareError("");
    let cameraStream: MediaStream | null = null;
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: cameraConstraintsFor(),
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
        .map((peer) => findVideoSender(peer))
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
      const id = callIdRef.current;
      if (id) {
        try {
          send({
            type: groupModeRef.current
              ? "call.group_media_state"
              : "call.media_state",
            call_id: id,
            screen_sharing: screenSharingRef.current,
            screen_audio: screenAudioSharingRef.current,
            microphone_muted: mutedRef.current,
            camera_enabled: true,
          });
        } catch {
          // Signaling disconnect handling reports the connection failure.
        }
      }
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
  }, [cameraOff, send]);

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
    const cameraTrack =
      cameraTrackRef.current?.readyState === "live"
        ? cameraTrackRef.current
        : null;
    const screenAudioSenders = peers
      .map((peer) => screenAudioSendersRef.current.get(peer))
      .filter((sender): sender is RTCRtpSender => Boolean(sender));
    try {
      const videoRestores = peers.flatMap((peer) => {
        const dedicatedSender = screenVideoSendersRef.current.get(peer);
        const primarySender = findVideoSender(peer, dedicatedSender);
        const restores: Promise<void>[] = [];
        if (dedicatedSender) {
          restores.push(dedicatedSender.replaceTrack(null));
        }
        if (
          primarySender &&
          (screenVideoFallbackPeersRef.current.has(peer) ||
            !dedicatedSender)
        ) {
          restores.push(primarySender.replaceTrack(cameraTrack));
        }
        return restores;
      });
      await Promise.all(videoRestores);
      await Promise.all(
        screenAudioSenders.map((sender) => sender.replaceTrack(null)),
      );
    } catch {
      setScreenShareError("Не удалось восстановить камеру или микрофон");
    } finally {
      screenTrack.stop();
      screenAudioTrackRef.current?.stop();
      screenAudioTrackRef.current = null;
      setLocalScreenStream(null);
      const sourceStream = localStreamRef.current;
      setLocalStream(
        sourceStream ? new MediaStream(sourceStream.getTracks()) : null,
      );
      screenSharingRef.current = false;
      screenAudioSharingRef.current = false;
      setScreenSharing(false);
      setScreenAudioSharing(false);
      screenVideoFallbackPeersRef.current.clear();
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
          microphone_muted: mutedRef.current,
          camera_enabled: Boolean(cameraTrack?.enabled),
        });
      } catch {
        // A signaling disconnect is handled by the call socket.
      }
    }
  }, [send]);

  const toggleScreenShare = useCallback(async () => {
    if (isMobileCallDevice()) {
      setScreenShareError(
        "Демонстрация экрана недоступна в мобильной версии ChatWave",
      );
      return;
    }
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
    if (
      window.chatWaveDesktop &&
      !desktopCaptureApprovedRef.current
    ) {
      try {
        const sources = await window.chatWaveDesktop.getScreenSources();
        if (!sources.length) {
          setScreenShareError("Нет доступных окон или экранов");
          return;
        }
        setDesktopScreenSources(sources);
      } catch {
        setScreenShareError(
          window.chatWaveDesktop.platform === "darwin"
            ? "Разрешите ChatWave запись экрана в Системных настройках → Конфиденциальность и безопасность → Запись экрана"
            : "Не удалось получить список окон",
        );
      }
      return;
    }
    desktopCaptureApprovedRef.current = false;
    let displayStream: MediaStream | null = null;
    try {
      const quality = SCREEN_SHARE_PRESETS[screenShareQuality];
      const supportedConstraints =
        navigator.mediaDevices.getSupportedConstraints() as Record<
          string,
          boolean | undefined
        >;
      const protectsOwnAudio = Boolean(
        supportedConstraints.restrictOwnAudio,
      );
      const desktopSelection = desktopCaptureSelectionRef.current;
      if (window.chatWaveDesktop && desktopSelection) {
        const captureDesktop = (withAudio: boolean) =>
          navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: withAudio,
          });
        try {
          displayStream = await captureDesktop(desktopSelection.withAudio);
        } catch (reason) {
          if (!desktopSelection.withAudio) throw reason;

          // Loopback capture is not available on every Windows device/driver.
          // Re-arm Electron's one-shot source selection and preserve the
          // screen video instead of failing the entire demonstration.
          await window.chatWaveDesktop.selectScreenSource(
            desktopSelection.sourceId,
            false,
          );
          displayStream = await captureDesktop(false);
          setScreenShareError(
            "Экран транслируется без системного звука: аудиозахват недоступен",
          );
        }
      } else {
        if (!navigator.mediaDevices?.getDisplayMedia) {
          throw new Error(
            "Этот браузер не поддерживает демонстрацию экрана",
          );
        }
        const preferredDisplayOptions = {
          video: {
            width: { ideal: quality.width },
            height: { ideal: quality.height },
            frameRate: { ideal: quality.fps, max: quality.fps },
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
        } as DisplayMediaStreamOptions;
        try {
          displayStream =
            await navigator.mediaDevices.getDisplayMedia(
              preferredDisplayOptions,
            );
        } catch (reason) {
          if (
            reason instanceof DOMException &&
            reason.name === "NotAllowedError"
          ) {
            throw reason;
          }
          try {
            // Older Chromium and Safari reject non-standard picker hints
            // before opening the chooser.
            displayStream =
              await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true,
              });
          } catch (fallbackReason) {
            if (
              fallbackReason instanceof DOMException &&
              fallbackReason.name === "NotAllowedError"
            ) {
              throw fallbackReason;
            }
            // A number of drivers expose display video but reject system
            // audio. Keep the demonstration usable instead of failing both.
            displayStream =
              await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: false,
              });
            setScreenShareError(
              "Экран транслируется без системного звука: аудиозахват недоступен",
            );
          }
        }
      }
      desktopCaptureSelectionRef.current = null;
      const screenTrack = displayStream.getVideoTracks()[0];
      const peers = groupModeRef.current
        ? [...groupPeersRef.current.values()]
        : peerRef.current
          ? [peerRef.current]
          : [];
      const videoTargets = peers.flatMap((peer) => {
        const dedicatedSender = screenVideoSendersRef.current.get(peer);
        const primarySender = findVideoSender(peer, dedicatedSender);
        const targets: Array<{
          peer: RTCPeerConnection;
          sender: RTCRtpSender;
        }> = [];
        if (dedicatedSender) {
          targets.push({ peer, sender: dedicatedSender });
        }
        if (primarySender) {
          // Some Chromium/Electron combinations negotiate an inactive
          // dedicated screen m-line and never start RTP after replaceTrack().
          // Mirroring to the already active primary video sender keeps screen
          // sharing reliable; stopScreenShare restores the camera track.
          screenVideoFallbackPeersRef.current.add(peer);
          targets.push({ peer, sender: primarySender });
        }
        return targets;
      });
      if (
        !screenTrack ||
        (videoTargets.length === 0 && !groupModeRef.current)
      ) {
        throw new Error("Видеоканал звонка недоступен");
      }

      screenTrack.contentHint = "detail";
      await screenTrack
        .applyConstraints({
          width: { ideal: quality.width },
          height: { ideal: quality.height },
          frameRate: { ideal: quality.fps, max: quality.fps },
        })
        .catch(() => undefined);
      await Promise.all(
        videoTargets.map(({ sender }) => sender.replaceTrack(screenTrack)),
      );
      for (const { sender: videoSender } of videoTargets) {
        try {
          const senderParameters = videoSender.getParameters();
          senderParameters.degradationPreference = "maintain-resolution";
          if (senderParameters.encodings.length === 0) {
            senderParameters.encodings = [{}];
          }
          senderParameters.encodings = senderParameters.encodings.map(
            (encoding) => ({
              ...encoding,
              maxBitrate: quality.bitrate,
              maxFramerate: quality.fps,
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
          const screenAudioSenders = peers
            .map((peer) => screenAudioSendersRef.current.get(peer))
            .filter((sender): sender is RTCRtpSender => Boolean(sender));
          if (screenAudioSenders.length > 0 || groupModeRef.current) {
            try {
              displayAudioTrack.contentHint = "music";
              await Promise.all(
                screenAudioSenders.map((sender) =>
                  sender.replaceTrack(displayAudioTrack),
                ),
              );
              for (const audioSender of screenAudioSenders) {
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
              screenAudioTrackRef.current = displayAudioTrack;
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
      setLocalScreenStream(new MediaStream([screenTrack]));
      screenSharingRef.current = true;
      screenAudioSharingRef.current = sharesAudio;
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
            microphone_muted: mutedRef.current,
            camera_enabled: false,
          });
        } catch {
          // A signaling disconnect is handled by the call socket.
        }
      }
    } catch (reason) {
      desktopCaptureSelectionRef.current = null;
      displayStream?.getTracks().forEach((track) => track.stop());
      const cameraTrack =
        cameraTrackRef.current?.readyState === "live"
          ? cameraTrackRef.current
          : null;
      await Promise.allSettled(
        [...screenVideoFallbackPeersRef.current].map((peer) => {
          const dedicatedSender = screenVideoSendersRef.current.get(peer);
          return findVideoSender(peer, dedicatedSender)?.replaceTrack(
            cameraTrack,
          );
        }),
      );
      screenVideoFallbackPeersRef.current.clear();
      if (reason instanceof DOMException && reason.name === "NotAllowedError") {
        setScreenShareError(
          window.chatWaveDesktop?.platform === "darwin"
            ? "Нет доступа к экрану. Разрешите ChatWave запись экрана в Системных настройках и перезапустите приложение"
            : "Демонстрация экрана отменена",
        );
      } else {
        setScreenShareError(
          reason instanceof Error
            ? reason.message
            : "Не удалось начать демонстрацию экрана",
        );
      }
    }
  }, [screenShareQuality, send, stopScreenShare]);

  const setScreenShareQuality = useCallback(
    (quality: ScreenShareQuality) => {
      setScreenShareQualityState(quality);
      window.localStorage.setItem(SCREEN_QUALITY_STORAGE_KEY, quality);
    },
    [],
  );

  const selectDesktopScreenSource = useCallback(
    async (sourceId: string, withAudio: boolean) => {
      if (!window.chatWaveDesktop) return;
      try {
        desktopCaptureSelectionRef.current = { sourceId, withAudio };
        await window.chatWaveDesktop.selectScreenSource(
          sourceId,
          withAudio,
        );
        setDesktopScreenSources([]);
        desktopCaptureApprovedRef.current = true;
        await toggleScreenShare();
      } catch {
        desktopCaptureApprovedRef.current = false;
        desktopCaptureSelectionRef.current = null;
        setScreenShareError("Не удалось выбрать источник демонстрации");
      }
    },
    [toggleScreenShare],
  );

  const cancelDesktopScreenPicker = useCallback(() => {
    desktopCaptureApprovedRef.current = false;
    desktopCaptureSelectionRef.current = null;
    setDesktopScreenSources([]);
    void window.chatWaveDesktop?.cancelScreenSource();
  }, []);

  const toggleScreenAudio = useCallback(() => {
    const screenAudioTrack = screenAudioTrackRef.current;
    if (!screenTrackRef.current || !screenAudioTrack) {
      setScreenShareError(
        "В этой демонстрации нет звуковой дорожки",
      );
      return;
    }
    const next = !screenAudioSharingRef.current;
    screenAudioTrack.enabled = next;
    screenAudioSharingRef.current = next;
    setScreenAudioSharing(next);
    setScreenShareError("");
    if (callIdRef.current) {
      try {
        send({
          type: groupModeRef.current
            ? "call.group_media_state"
            : "call.media_state",
          call_id: callIdRef.current,
          screen_sharing: true,
          screen_audio: next,
          microphone_muted: mutedRef.current,
          camera_enabled: Boolean(cameraTrackRef.current?.enabled),
        });
      } catch {
        // Signaling disconnect handling reports the connection failure.
      }
    }
  }, [send]);

  return {
    ready,
    phase,
    media,
    conversationId,
    callId,
    groupCall,
    availableGroupCalls,
    remoteStream,
    remoteStreams,
    remoteScreenStream,
    groupScreenStreams,
    remoteScreenAudioStream,
    groupScreenAudioStreams,
    remoteMediaStates,
    localStream,
    localScreenStream,
    muted,
    cameraOff,
    screenSharing,
    screenAudioSharing,
    screenShareQuality,
    remoteScreenSharing,
    remoteScreenAudioSharing,
    remoteMuted,
    remoteCameraEnabled,
    audioOutputDeviceId,
    screenShareError,
    desktopScreenSources,
    error,
    start,
    accept,
    joinAvailableGroupCall,
    retry,
    end,
    reset,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    toggleScreenAudio,
    setScreenShareQuality,
    selectDesktopScreenSource,
    cancelDesktopScreenPicker,
  };
}
