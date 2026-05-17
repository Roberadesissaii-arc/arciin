"use client"

import { useEffect, useMemo } from "react"
import { io, type Socket } from "socket.io-client"

import { NotificationInboxHydrator } from "@/components/notifications/notification-inbox-hydrator"
import { useSocketEvents } from "@/hooks/use-socket-events"
import { getClientSocketUrl } from "@/lib/realtime/client-socket-url"
import { useSocketStore } from "@/lib/stores/socket-store"

export function SocketProvider({
  userId,
  children,
}: {
  userId?: string
  children: React.ReactNode
}) {
  const setConnected = useSocketStore((state) => state.setConnected)
  const socketUrl = useMemo(getClientSocketUrl, [])
  const socket = useMemo<Socket | null>(() => {
    if (!userId) {
      return null
    }

    return io(socketUrl, {
      withCredentials: true,
      autoConnect: false,
    })
  }, [socketUrl, userId])

  useEffect(() => {
    if (!userId) {
      setConnected(false)
      return
    }

    socket?.connect()

    return () => {
      socket?.disconnect()
      setConnected(false)
    }
  }, [setConnected, socket, userId])

  useSocketEvents(socket)

  return (
    <>
      <NotificationInboxHydrator />
      {children}
    </>
  )
}
