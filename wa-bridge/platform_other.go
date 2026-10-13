//go:build !windows

package main

import (
	"fmt"
	"net"
	"os"
)

// Di luar Windows (mis. Mac/Linux untuk uji coba) program dijalankan manual dari terminal;
// tidak ada pemasangan otomatis. Satu instance saja per komputer.
func platformStartup(string) bool {
	ln, err := net.Listen("tcp", "127.0.0.1:47391")
	if err != nil {
		fmt.Fprintln(os.Stderr, "Kalaatma WA sudah berjalan di komputer ini.")
		return true
	}
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			c.Close()
		}
	}()
	return false
}

func showMessage(title, msg string) { fmt.Fprintf(os.Stderr, "%s: %s\n", title, msg) }
