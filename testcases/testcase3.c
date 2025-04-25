#include <assert.h>
#include "klee.h"
#include <stdio.h>
#include <limits.h>

#ifndef OMITBAD

void CWE190_Integer_Overflow__char_symbolic_add_01_bad()
{
    char data;
    data = ' ';
    klee_make_symbolic(&data, sizeof(data), "data");

    {
        char result = data + 1;
        if (result < data)
        {
            klee_assert(0 && "Integer overflow detected in bad()");
        }
    }
}

#endif /* OMITBAD */

#ifndef OMITGOOD

static void goodG2B()
{
    char data;
    data = 2;

    {
        char result = data + 1;
        // 无需检查，因为已知安全
    }
}

/* goodB2G uses the BadSource with the GoodSink */
static void goodB2G()
{
    char data;
    data = ' ';
    klee_make_symbolic(&data, sizeof(data), "data");

    klee_assume(data >= 0); // char 可能是有符号的，控制在非负区间

    if (data < CHAR_MAX)
    {
        char result = data + 1;
    }
    else
    {

    }
}

void CWE190_Integer_Overflow__char_symbolic_add_01_good()
{
    goodG2B();
    goodB2G();
}

#endif /* OMITGOOD */

#ifdef INCLUDEMAIN

int main(int argc, char *argv[])
{
    srand((unsigned)time(NULL));
#ifndef OMITGOOD
    printf("Calling good()...\n");
    CWE190_Integer_Overflow__char_symbolic_add_01_good();
    printf("Finished good()\n");
#endif /* OMITGOOD */
#ifndef OMITBAD
    printf("Calling bad()...\n");
    CWE190_Integer_Overflow__char_symbolic_add_01_bad();
    printf("Finished bad()\n");
#endif /* OMITBAD */
    return 0;
}

#endif
