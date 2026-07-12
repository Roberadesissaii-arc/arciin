"use client"

import { createContext, useContext } from "react"
import type { Socket } from "socket.io-client"

const SocketContext = createContext<Socket | null>(null)

export function SocketContextProvider({
  socket,
  children,
}: {
  socket: Socket | null
  children: React.ReactNode
}) {
  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
}

export function useAppSocket(): Socket | null {
  return useContext(SocketContext)
}
