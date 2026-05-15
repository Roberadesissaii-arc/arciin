"use client"

import { useEffect, useMemo } from "react"
import { io, type Socket } from "socket.io-client"

import { useSocketEvents } from "@/hooks/use-socket-events"
import { useSocketStore } from "@/lib/stores/socket-store"

export function SocketProvider({
  userId,
  children,
}: {
  userId?: string
  children: React.ReactNode
}) {
  const setConnected = useSocketStore((state) => state.setConnected)
  // Socket.IO is served by the Fastify API (not Next). Default to :4000; set NEXT_PUBLIC_SOCKET_URL
  // in production (e.g. wss://your-host or http://api:4000). next.config rewrites /socket.io only help
  // if the client connects to the web origin and you configure the client URL accordingly.
  const socketUrl = useMemo(
    () => process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000",
    []
  )
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

  return children
}
