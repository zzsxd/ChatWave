from fastapi import APIRouter, Depends, status
from fastapi.security.oauth2 import OAuth2PasswordRequestForm
from typing import Annotated

from dependencies import revoke_token
from schemas import CreateUser
from services import get_access_token, create_user
from utilities import oauth2_scheme


authorization_router = APIRouter(
    tags=['Authorization'],
    prefix="/auth"
)


@authorization_router.post('/login', status_code=status.HTTP_200_OK, response_model=dict)
async def login(request: Annotated[OAuth2PasswordRequestForm, Depends()]):
    access_token = await get_access_token(username=request.username, password=request.password)
    return {"access_token": access_token, "token_type": "bearer"}


@authorization_router.post('/signup', status_code=status.HTTP_201_CREATED)
async def signup(request: CreateUser):
    await create_user(request_data=request)


@authorization_router.post('/logout', status_code=status.HTTP_204_NO_CONTENT)
async def logout(token: Annotated[str, Depends(oauth2_scheme)]):
    await revoke_token(token)
