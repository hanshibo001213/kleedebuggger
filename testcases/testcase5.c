#include "klee.h"
#include <stdio.h>

void printIntLine(int i)
{
    if (klee_is_symbolic(i))
    {
        klee_warning("printIntLine called with symbolic value");
        klee_print_expr("symbolic value: ", i);
    }
    else
    {
        printf("%d\n", i);
    }
}

void printLine(const char *line)
{
    printf("%s\n", line);
}

void CWE121_bad()
{
    int data;
    int i;
    int buffer[10] = {0};

    klee_make_symbolic(&data, sizeof(data), "data");

    if (data >= 0)
    {
        buffer[data] = 1;
        for (i = 0; i < 10; i++)
        {
            printIntLine(buffer[i]);
        }
    }
    else
    {
        printLine("ERROR: Array index is negative.");
    }
}

void CWE121_goodG2B()
{
    int data;
    int i;
    int buffer[10] = {0};

    /* GOOD: 使用 safe 的 concrete 值 */
    data = 7;

    if (data >= 0)
    {
        buffer[data] = 1;
        for (i = 0; i < 10; i++)
        {
            printIntLine(buffer[i]);
        }
    }
    else
    {
        printLine("ERROR: Array index is negative.");
    }
}

void CWE121_goodB2G()
{
    int data;
    int i;
    int buffer[10] = {0};

    klee_make_symbolic(&data, sizeof(data), "data");

    if (data >= 0 && data < 10)
    {
        buffer[data] = 1;
        for (i = 0; i < 10; i++)
        {
            printIntLine(buffer[i]);
        }
    }
    else
    {
        printLine("ERROR: Array index is out-of-bounds.");
    }
}

int main()
{
    CWE121_bad();
    CWE121_goodG2B();
    CWE121_goodB2G();
    return 0;
}
