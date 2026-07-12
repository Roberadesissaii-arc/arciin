"use client"

import { useEffect, useMemo } from "react"
import { io, type Socket } from "socket.io-client"

import { NotificationInboxHydrator } from "@/components/notifications/notification-inbox-hydrator"
import { SocketContextProvider } from "@/components/providers/socket-context"
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
  const socketUrl = useMemo(() => getClientSocketUrl(), [])
  const socket = useMemo<Socket | null>(() => {
    if (!userId) {
      return null
    }

    return io(socketUrl, {
      path: "/socket.io",
      withCredentials: true,
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_500,
      reconnectionDelayMax: 10_000,
      transports: ["polling", "websocket"],
    })
  }, [socketUrl, userId])

  useEffect(() => {
    if (!userId || !socket) {
      setConnected(false)
      return
    }

    const onConnect = () => {
      setConnected(true)
      socket.emit("subscribe:instance-events")
    }
    const onDisconnect = () => setConnected(false)
    const onReconnect = () => {
      setConnected(true)
      socket.emit("subscribe:instance-events")
    }

    socket.on("connect", onConnect)
    socket.on("disconnect", onDisconnect)
    socket.io.on("reconnect", onReconnect)

    socket.connect()
    if (socket.connected) {
      onConnect()
    }

    return () => {
      socket.off("connect", onConnect)
      socket.off("disconnect", onDisconnect)
      socket.io.off("reconnect", onReconnect)
      socket.disconnect()
      setConnected(false)
    }
  }, [setConnected, socket, userId])

  useSocketEvents(socket)

  return (
    <SocketContextProvider socket={socket}>
      <NotificationInboxHydrator />
      {children}
    </SocketContextProvider>
  )
}
