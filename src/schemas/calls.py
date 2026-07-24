from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator


class CallSignalModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SessionDescription(CallSignalModel):
    type: Literal["offer", "answer"]
    sdp: Annotated[str, Field(min_length=1, max_length=262_144)]


class IceCandidate(CallSignalModel):
    candidate: Annotated[str, Field(max_length=8_192)]
    sdpMid: Annotated[str | None, Field(default=None, max_length=256)]
    sdpMLineIndex: Annotated[int | None, Field(default=None, ge=0, le=65_535)]
    usernameFragment: Annotated[str | None, Field(default=None, max_length=256)]


class StartCall(CallSignalModel):
    type: Literal["call.start"]
    conversation_id: Annotated[int, Field(ge=1, le=2_147_483_647)]
    media: Literal["audio", "video"]
    offer: SessionDescription

    @field_validator("offer")
    @classmethod
    def require_offer(cls, value: SessionDescription) -> SessionDescription:
        if value.type != "offer":
            raise ValueError("Expected an SDP offer")
        return value


class AcceptCall(CallSignalModel):
    type: Literal["call.accept"]
    call_id: Annotated[int, Field(ge=1, le=2_147_483_647)]
    answer: SessionDescription

    @field_validator("answer")
    @classmethod
    def require_answer(cls, value: SessionDescription) -> SessionDescription:
        if value.type != "answer":
            raise ValueError("Expected an SDP answer")
        return value


class CallCandidate(CallSignalModel):
    type: Literal["call.candidate"]
    call_id: Annotated[int, Field(ge=1, le=2_147_483_647)]
    candidate: IceCandidate


class CallAction(CallSignalModel):
    type: Literal["call.reject", "call.cancel", "call.end"]
    call_id: Annotated[int, Field(ge=1, le=2_147_483_647)]


class CallHeartbeat(CallSignalModel):
    type: Literal["call.heartbeat"]
    call_id: Annotated[int, Field(ge=1, le=2_147_483_647)]


class CallMediaState(CallSignalModel):
    type: Literal["call.media_state"]
    call_id: Annotated[int, Field(ge=1, le=2_147_483_647)]
    screen_sharing: bool
    screen_audio: bool = False


class StartGroupCall(CallSignalModel):
    type: Literal["call.group_start"]
    conversation_id: Annotated[int, Field(ge=1, le=2_147_483_647)]
    media: Literal["audio", "video"]


class JoinGroupCall(CallSignalModel):
    type: Literal["call.group_join"]
    call_id: Annotated[int, Field(ge=1, le=2_147_483_647)]


class LeaveGroupCall(CallSignalModel):
    type: Literal["call.group_leave"]
    call_id: Annotated[int, Field(ge=1, le=2_147_483_647)]


class GroupCallOffer(CallSignalModel):
    type: Literal["call.group_offer"]
    call_id: Annotated[int, Field(ge=1, le=2_147_483_647)]
    target_user_id: Annotated[int, Field(ge=1, le=2_147_483_647)]
    offer: SessionDescription

    @field_validator("offer")
    @classmethod
    def require_offer(cls, value: SessionDescription) -> SessionDescription:
        if value.type != "offer":
            raise ValueError("Expected an SDP offer")
        return value


class GroupCallAnswer(CallSignalModel):
    type: Literal["call.group_answer"]
    call_id: Annotated[int, Field(ge=1, le=2_147_483_647)]
    target_user_id: Annotated[int, Field(ge=1, le=2_147_483_647)]
    answer: SessionDescription

    @field_validator("answer")
    @classmethod
    def require_answer(cls, value: SessionDescription) -> SessionDescription:
        if value.type != "answer":
            raise ValueError("Expected an SDP answer")
        return value


class GroupCallCandidate(CallSignalModel):
    type: Literal["call.group_candidate"]
    call_id: Annotated[int, Field(ge=1, le=2_147_483_647)]
    target_user_id: Annotated[int, Field(ge=1, le=2_147_483_647)]
    candidate: IceCandidate


class GroupCallMediaState(CallSignalModel):
    type: Literal["call.group_media_state"]
    call_id: Annotated[int, Field(ge=1, le=2_147_483_647)]
    screen_sharing: bool
    screen_audio: bool = False


CallSignal = Annotated[
    Union[
        StartCall,
        AcceptCall,
        CallCandidate,
        CallAction,
        CallHeartbeat,
        CallMediaState,
        StartGroupCall,
        JoinGroupCall,
        LeaveGroupCall,
        GroupCallOffer,
        GroupCallAnswer,
        GroupCallCandidate,
        GroupCallMediaState,
    ],
    Field(discriminator="type"),
]
call_signal_adapter = TypeAdapter(CallSignal)


def parse_call_signal(payload: object) -> CallSignal:
    return call_signal_adapter.validate_python(payload)
